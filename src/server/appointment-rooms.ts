import { and, eq, inArray } from "drizzle-orm";

import { appointment, office, practitioner, room, schedule } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import {
  activeAppointmentStatuses,
  overbookingInputSchema,
  roomMoveSchema,
} from "#/lib/appointments.ts";
import type { OverbookingInput, RoomMove, WarningConfirmation } from "#/lib/appointments.ts";
import { coveringSchedule, occurrencesDuring } from "#/lib/availability.ts";
import { findCrowding } from "#/lib/room-space.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import {
  booksForSome,
  checkTypeAndPatient,
  findBookablePractitioner,
  findPatientWarnings,
} from "#/server/appointments.ts";
import type { PatientWarning } from "#/server/appointments.ts";
import { recordAudit } from "#/server/audit.ts";
import { findBlocking, findFreeTimes, meets } from "#/server/availability.ts";

// Appointments outside their schedule's room: overbookings (ui: "Sobreturno"),
// booked on purpose over another appointment or outside the practitioner's
// schedules, and moving an appointment to another room. Either needs a room
// with space (docs/domain/appointments.md § Booking), checked under a lock on
// the room row, as saving a schedule checks it. Who may act is as for booking.
// `database` is for tests, which pass a transaction running as the app role.

/** What holds a room when it has no space: a schedule or an appointment, and whose. */
export interface RoomOccupant {
  practitionerName: string;
  kind: "schedule" | "appointment";
  start: Date;
  end: Date;
}

type RoomRefusal =
  | { ok: false; reason: "notFound" | "roomInactive" | "officeInactive" }
  | { ok: false; reason: "roomFull"; occupants: RoomOccupant[] };

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
        | "appointmentTypeInactive"
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

/** Every practitioner in the room during `span`, through a schedule or an appointment. */
async function findPresences(tx: Transaction, roomId: string, span: TimeRange, timeZone: string) {
  const schedules = await tx
    .select({
      practitionerId: schedule.practitionerId,
      practitionerName: practitioner.displayName,
      officeId: room.officeId,
      roomId: schedule.roomId,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(room, eq(room.id, schedule.roomId))
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .where(eq(schedule.roomId, roomId));
  const appointments = await tx
    .select({
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      during: appointment.during,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .where(
      and(
        eq(appointment.roomId, roomId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment.during, span),
      ),
    );
  return [
    ...schedules.flatMap(({ practitionerId, practitionerName, ...slot }) =>
      occurrencesDuring({ ...slot, timeZone }, span).map((occurrence) => ({
        practitionerId,
        practitionerName,
        kind: "schedule" as const,
        ...occurrence,
      })),
    ),
    ...appointments.map(({ practitionerId, practitionerName, during }) => ({
      practitionerId,
      practitionerName,
      kind: "appointment" as const,
      ...during,
    })),
  ];
}

/**
 * Whether the room has space for the practitioner during `span`. Locks the
 * room row for the rest of the transaction, so two checks of one room run one
 * after the other.
 */
async function checkRoomSpace(
  tx: Transaction,
  roomId: string,
  practitionerId: string,
  span: TimeRange,
): Promise<{ ok: true; officeId: string; timeZone: string } | RoomRefusal> {
  await tx.select({ id: room.id }).from(room).where(eq(room.id, roomId)).for("update");
  const [target] = await tx
    .select({
      officeId: room.officeId,
      active: room.active,
      capacity: room.capacity,
      officeActive: office.active,
      timeZone: office.timeZone,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, roomId));
  if (!target) {
    return { ok: false, reason: "notFound" };
  }
  if (!target.officeActive) {
    return { ok: false, reason: "officeInactive" };
  }
  if (!target.active) {
    return { ok: false, reason: "roomInactive" };
  }
  const presences = await findPresences(tx, roomId, span, target.timeZone);
  const crowding = findCrowding(span, practitionerId, presences, target.capacity);
  if (crowding) {
    const occupants = crowding
      .map(({ practitionerName, kind, start, end }) => ({ practitionerName, kind, start, end }))
      .sort((a, b) => +a.start - +b.start || a.practitionerName.localeCompare(b.practitionerName));
    return { ok: false, reason: "roomFull", occupants };
  }
  return { ok: true, officeId: target.officeId, timeZone: target.timeZone };
}

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
  const { patientId, practitionerId, appointmentTypeId, start, durationMinutes, receptionNote } =
    parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const refused = await checkTypeAndPatient(tx, found.id, appointmentTypeId, patientId);
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
        appointmentTypeId,
        roomId,
        overbooking: true,
        receptionNote,
      };
      const [created] = await tx
        .insert(appointment)
        .values({
          ...values,
          during: span,
          organizationId: actor.organizationId,
          createdBy: actor.userId,
        })
        .returning({ id: appointment.id });
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "appointment",
        entityId: created!.id,
        patientId,
        before: null,
        after: {
          ...values,
          start: span.start.toISOString(),
          end: span.end.toISOString(),
          status: "booked",
        },
      });
      return { ok: true as const, appointment: { id: created!.id } };
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
      const [current] = await tx
        .select({
          practitionerId: appointment.practitionerId,
          patientId: appointment.patientId,
          roomId: appointment.roomId,
          officeId: room.officeId,
          during: appointment.during,
        })
        .from(appointment)
        .innerJoin(room, eq(room.id, appointment.roomId))
        .where(
          and(
            eq(appointment.id, appointmentId),
            inArray(appointment.status, [...activeAppointmentStatuses]),
          ),
        );
      if (!current) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const found = await findBookablePractitioner(tx, actor, current.practitionerId);
      if (!found.ok) {
        return found;
      }
      if (roomId === current.roomId) {
        return { ok: true as const };
      }
      const space = await checkRoomSpace(tx, roomId, found.id, current.during);
      if (!space.ok) {
        return space;
      }
      if (space.officeId !== current.officeId) {
        return { ok: false as const, reason: "otherOffice" as const };
      }
      await tx
        .update(appointment)
        .set({ roomId, updatedAt: new Date() })
        .where(eq(appointment.id, appointmentId));
      await recordAudit(tx, actor, {
        action: "update",
        entityType: "appointment",
        entityId: appointmentId,
        patientId: current.patientId,
        before: { roomId: current.roomId },
        after: { roomId },
      });
      return { ok: true as const };
    },
    database,
  );
}
