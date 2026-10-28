import { and, eq, inArray } from "drizzle-orm";

import { appointment } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { rescheduleSchema } from "#/lib/appointments.ts";
import type { RescheduleInput, WarningConfirmation } from "#/lib/appointments.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { placeOverbooking } from "#/server/appointment-rooms.ts";
import type { OverbookingResult } from "#/server/appointment-rooms.ts";
import {
  booksForSome,
  findBookablePractitioner,
  findPatientWarnings,
  localDay,
  updateAppointment,
} from "#/server/appointments.ts";
import type { BookingResult } from "#/server/appointments.ts";
import { changedFields, recordAudit } from "#/server/audit.ts";
import { findFreeTimes, toAvailableStarts } from "#/server/availability.ts";

// Rescheduling (docs/domain/appointments.md § Rescheduling) moves the same
// appointment, booked or confirmed, to a new time, under the checks of
// booking: a free start of the practitioner's, which takes its schedule's room
// and may be in another office, or an overbooking, placed by the overbooking and
// room-space rules. The appointment's own time counts as free. The audit entry
// keeps the previous values. Who may act is as for booking. `database` is for
// tests, which pass a transaction running as the app role.

export type RescheduleResult =
  | { ok: true }
  | Exclude<BookingResult, { ok: true }>
  | Exclude<OverbookingResult, { ok: true }>;

const reschedulable = ["booked", "confirmed"] as const;

type Practitioner = { id: string; gridMinutes: number };

/** Where the appointment goes at `span`: a free start's room, or an overbooking's. */
async function placeAppointment(
  tx: Transaction,
  found: Practitioner,
  span: TimeRange,
  move: { appointmentId: string; overbooking: boolean; roomId: string | null },
) {
  if (move.overbooking) {
    return placeOverbooking(tx, found, span, move.roomId);
  }
  const { free, schedules } = await findFreeTimes(tx, found, {
    window: { start: span.start, end: new Date(+span.start + 1) },
    durationMinutes: (+span.end - +span.start) / 60_000,
    excludeAppointmentId: move.appointmentId,
  });
  const slot = free.find((candidate) => +candidate.start === +span.start);
  if (!slot) {
    return { ok: false as const, reason: "notFree" as const };
  }
  const { timeZone } = schedules.find((row) => row.roomId === slot.roomId)!;
  return { ok: true as const, roomId: slot.roomId, timeZone };
}

/** Moves a booked or confirmed appointment to a new time, and with it its room. */
export async function rescheduleAppointment(
  actor: Actor,
  input: RescheduleInput & WarningConfirmation,
  database?: AnyDatabase,
): Promise<RescheduleResult> {
  if (!booksForSome(actor)) {
    return { ok: false, reason: "forbidden" };
  }
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { appointmentId, start, durationMinutes, overbooking, roomId } = parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select({
          patientId: appointment.patientId,
          practitionerId: appointment.practitionerId,
          roomId: appointment.roomId,
          during: appointment.during,
          overbooking: appointment.overbooking,
        })
        .from(appointment)
        .where(
          and(eq(appointment.id, appointmentId), inArray(appointment.status, [...reschedulable])),
        );
      if (!current) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const found = await findBookablePractitioner(tx, actor, current.practitionerId);
      if (!found.ok) {
        return found;
      }
      const placed = await placeAppointment(tx, found, span, {
        appointmentId,
        overbooking,
        roomId,
      });
      if (!placed.ok) {
        return placed;
      }

      const warnings =
        input.confirmWarnings === true
          ? []
          : await findPatientWarnings(tx, current.patientId, span, placed.timeZone, appointmentId);
      if (warnings.length > 0) {
        return { ok: false as const, reason: "patientWarning" as const, warnings };
      }

      const next = { during: span, roomId: placed.roomId, overbooking };
      const updated = await updateAppointment(tx, appointmentId, next);
      if (!updated.ok) {
        const fresh = await findFreeTimes(tx, found, {
          window: localDay(start, placed.timeZone),
          durationMinutes,
          excludeAppointmentId: appointmentId,
        });
        return {
          ok: false as const,
          reason: "timeTaken" as const,
          freeStarts: toAvailableStarts(fresh.free, fresh.schedules),
        };
      }
      const changed = changedFields(
        { ...current.during, roomId: current.roomId, overbooking: current.overbooking },
        { ...span, roomId: placed.roomId, overbooking },
      );
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "appointment",
          entityId: appointmentId,
          patientId: current.patientId,
          ...changed,
        });
      }
      return { ok: true as const };
    },
    database,
  );
}
