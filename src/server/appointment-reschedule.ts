import { eq } from "drizzle-orm";

import { patient } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { rescheduleSchema } from "#/lib/appointments.ts";
import type {
  AppointmentStatus,
  RescheduleInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";

import { lockPlaced, movePlaced } from "#/server/appointment-placement.ts";
import type { OverbookingResult } from "#/server/appointment-rooms.ts";
import { booksForSome, findBookablePractitioner } from "#/server/appointments.ts";
import type { BookingResult } from "#/server/appointments.ts";

// Rescheduling (docs/domain/appointments.md § Rescheduling) moves the same
// appointment, booked or confirmed, to a new time, under the checks of
// booking: a free start of the practitioner's, which takes its schedule's room
// and may be in another office, or an overbooking, placed by the overbooking and
// room-space rules. The appointment's own time counts as free. The audit entry
// keeps the previous values. The placement module (`appointment-placement.ts`)
// does all of that; a deactivated patient's appointment is refused here. Who may
// act is as for booking. `database` is for tests, which pass a transaction running
// as the app role.

export type RescheduleResult =
  | { ok: true }
  | Exclude<BookingResult, { ok: true }>
  | Exclude<OverbookingResult, { ok: true }>;

const reschedulable: readonly AppointmentStatus[] = ["booked", "confirmed"];

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
      const placed = await lockPlaced(tx, appointmentId);
      if (!placed || !reschedulable.includes(placed.status)) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const found = await findBookablePractitioner(tx, actor, placed.practitionerId);
      if (!found.ok) {
        return found;
      }
      const [owner] = await tx
        .select({ active: patient.active })
        .from(patient)
        .where(eq(patient.id, placed.patientId));
      if (!owner!.active) {
        return { ok: false as const, reason: "patientInactive" as const };
      }
      return movePlaced(
        tx,
        actor,
        found,
        placed,
        overbooking
          ? { kind: "overbooking", span, pickedRoomId: roomId }
          : { kind: "freeStart", span },
        { confirmWarnings: input.confirmWarnings === true },
      );
    },
    database,
  );
}
