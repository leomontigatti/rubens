import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { isActiveStatus, overbookingInputSchema, roomMoveSchema } from "#/lib/appointments.ts";
import type { OverbookingInput, RoomMove, WarningConfirmation } from "#/lib/appointments.ts";
import { coveringSchedule } from "#/lib/availability.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { checkRoomSpace, lostRoomRace } from "#/server/appointment-placement-steps.ts";
import { lockPlaced, movePlaced } from "#/server/appointment-placement.ts";
import type { RoomRefusal } from "#/server/appointment-placement.ts";
import {
  booksForSome,
  checkServiceAndPatient,
  findBookablePractitioner,
  findPatientWarnings,
  insertAppointment,
} from "#/server/appointments.ts";
import type { PatientWarning } from "#/server/appointments.ts";
import { recordAudit } from "#/server/audit.ts";
import { findBlocking, findFreeTimes } from "#/server/availability.ts";

// Appointments outside their schedule's room: overbookings (ui: "Sobreturno"),
// booked on purpose over another appointment or outside the practitioner's
// schedules, and moving an appointment to another room. Either needs a room
// with space (docs/domain/appointments.md § Booking), checked under a lock on
// the room row, as saving a schedule checks it, which the placement module does
// (`appointment-placement.ts`). Who may act is as for booking.
// `database` is for tests, which pass a transaction running as the app role.

export type OverbookingResult =
  | { ok: true; appointment: { id: string } }
  | RoomRefusal
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalidInput"
        | "notFound"
        | "practitionerInactive"
        | "patientInactive"
        | "medicalServiceInactive"
        | "roomRequired"
        | "timeOff"
        | "closed";
    }
  | { ok: false; reason: "patientWarning"; warnings: PatientWarning[] };

export type RoomMoveResult =
  | { ok: true }
  | RoomRefusal
  | { ok: false; reason: "forbidden" | "invalidInput" | "practitionerInactive" | "otherOffice" };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;

/** Why the practitioner cannot work during `span` at the office; `null` when they can. */
async function checkWorkingTime(
  tx: Transaction,
  practitionerId: string,
  span: TimeRange,
  officeId: string,
): Promise<{ ok: false; reason: "timeOff" | "closed" } | null> {
  const blocking = await findBlocking(tx, practitionerId, span, [officeId]);
  if (blocking.timeOff.length > 0) {
    return { ok: false, reason: "timeOff" };
  }
  return blocking.closures.length > 0 ? { ok: false, reason: "closed" } : null;
}

/**
 * The room an overbooking goes in: the one picked, or else the schedule's it
 * falls inside, when that room has space and the practitioner works then.
 */
export async function placeOverbooking(
  tx: Transaction,
  practitioner: { id: string; gridMinutes: number },
  span: TimeRange,
  picked: string | null,
): Promise<
  | { ok: true; roomId: string; timeZone: string }
  | RoomRefusal
  | { ok: false; reason: "roomRequired" | "timeOff" | "closed" }
> {
  const { schedules } = await findFreeTimes(tx, practitioner, {
    window: span,
    durationMinutes: (+span.end - +span.start) / 60_000,
  });
  const roomId = picked ?? coveringSchedule(schedules, span)?.roomId;
  if (!roomId) {
    return { ok: false, reason: "roomRequired" };
  }
  const space = await checkRoomSpace(tx, roomId, practitioner.id, span);
  if (!space.ok) {
    return space;
  }
  const blocked = await checkWorkingTime(tx, practitioner.id, span, space.officeId);
  return blocked ?? { ok: true, roomId, timeZone: space.timeZone };
}

/**
 * Books an overbooking: at any start, skipping the free-time rule and the
 * overlap constraint, though never in time off or a closure. Inside one of
 * the practitioner's schedules it takes that schedule's room unless another
 * is picked; outside them a room must be picked. The patient's other
 * appointments that day warn until `confirmWarnings`.
 */
export async function bookOverbooking(
  actor: Actor,
  input: OverbookingInput & WarningConfirmation,
  database?: AnyDatabase,
): Promise<OverbookingResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = overbookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, practitionerId, medicalServiceId, start, durationMinutes, receptionNote } =
    parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const refused = await checkServiceAndPatient(tx, found.id, medicalServiceId, patientId);
      if (refused) {
        return refused;
      }
      const placed = await placeOverbooking(tx, found, span, parsed.data.roomId);
      if (!placed.ok) {
        return placed;
      }
      const { roomId } = placed;
      const warnings =
        input.confirmWarnings === true
          ? []
          : await findPatientWarnings(tx, patientId, span, placed.timeZone);
      if (warnings.length > 0) {
        return { ok: false as const, reason: "patientWarning" as const, warnings };
      }

      const values = {
        patientId,
        practitionerId: found.id,
        medicalServiceId,
        roomId,
        overbooking: true,
        receptionNote,
      };
      const created = await insertAppointment(tx, {
        ...values,
        during: span,
        organizationId: actor.organizationId,
        createdBy: actor.userId,
      });
      if (!created.ok) {
        return lostRoomRace(tx, roomId, found.id, span);
      }
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "appointment",
        entityId: created.id,
        patientId,
        before: null,
        after: {
          ...values,
          start: span.start.toISOString(),
          end: span.end.toISOString(),
          status: "booked",
        },
      });
      return { ok: true as const, appointment: { id: created.id } };
    },
    database,
  );
}

/**
 * Moves an active appointment to another room of its office, at the same
 * time, when that room has space.
 */
export async function moveAppointmentRoom(
  actor: Actor,
  input: RoomMove,
  database?: AnyDatabase,
): Promise<RoomMoveResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = roomMoveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, roomId } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const placed = await lockPlaced(tx, appointmentId);
      if (!placed || !isActiveStatus(placed.status)) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const found = await findBookablePractitioner(tx, actor, placed.practitionerId);
      if (!found.ok) {
        return found;
      }
      return movePlaced(tx, actor, found, placed, { kind: "sameTime", roomId });
    },
    database,
  );
}
