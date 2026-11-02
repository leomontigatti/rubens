import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { isActiveStatus, overbookingInputSchema, roomMoveSchema } from "#/lib/appointments.ts";
import type { OverbookingInput, RoomMove, WarningConfirmation } from "#/lib/appointments.ts";

import { lockPlaced, movePlaced, placeNew } from "#/server/appointment-placement.ts";
import type { PlacementRefusal } from "#/server/appointment-placement.ts";
import { booksForSome, findBookablePractitioner } from "#/server/appointments.ts";

// Appointments outside their schedule's room: overbookings (ui: "Sobreturno"),
// booked on purpose over another appointment or outside the practitioner's
// schedules, and moving an appointment to another room. Either needs a room
// with space (docs/domain/appointments.md § Booking), checked under a lock on
// the room row, as saving a schedule checks it, which the placement module does
// (`appointment-placement.ts`). Who may act is as for booking.
// `database` is for tests, which pass a transaction running as the app role.

export type OverbookingResult =
  | { ok: true; appointment: { id: string } }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" | "practitionerInactive" }
  | PlacementRefusal<"overbooking">;

export type RoomMoveResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalidInput" | "practitionerInactive" }
  | PlacementRefusal<"sameTime">;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;

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
  const { practitionerId, start, durationMinutes, roomId, ...visit } = parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const placed = await placeNew(
        tx,
        actor,
        found,
        visit,
        { kind: "overbooking", span, pickedRoomId: roomId },
        { confirmWarnings: input.confirmWarnings === true },
      );
      return placed.ok ? { ok: true as const, appointment: { id: placed.id } } : placed;
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
      return movePlaced(
        tx,
        actor,
        found,
        placed,
        { kind: "sameTime", roomId },
        { confirmWarnings: false },
      );
    },
    database,
  );
}
