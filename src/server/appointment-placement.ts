import { eq } from "drizzle-orm";

import { appointment, office, room } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";

import { checkRoomSpace, writeRoomChange } from "#/server/appointment-placement-steps.ts";
import type { RoomRefusal } from "#/server/appointment-placement-steps.ts";
import { recordAudit } from "#/server/audit.ts";

export type { RoomOccupant, RoomRefusal } from "#/server/appointment-placement-steps.ts";

// Appointment placement: every write that decides when and where an appointment
// holds time. A caller says what it wants as a placement and gets back success
// or a structured refusal; it owns its role gate, its parsing, `withTenant` and
// finding the practitioner, and nothing here opens a transaction.
//
// The sequence, whichever the caller:
//
// 1. Lock the appointment row, when there is one, and read it after the lock.
// 2. Resolve the room and take its row lock when the room's space is at stake.
//    Always in this order, appointment row then room row, so two changes never
//    wait on each other. A free start takes no room lock: see `checkRoomSpace`.
// 3. Check what the placement needs: room space, its office.
// 4. Write in a savepoint. The exclusion constraints stay the arbiter (ADR-0003):
//    the write reports which one fired, and the transaction survives to read why.
// 5. Recover a lost race into the refusal for that placement and constraint.
// 6. Audit the write in the same transaction.

/** A placement: what the caller wants of the appointment's time and room. */
type Placement = { kind: "sameTime"; roomId: string };

/**
 * Locks the appointment row for the rest of the transaction, so changes of one
 * appointment run one after the other, and reads it after the lock, as a change
 * that held the lock first left it. Taken before any room lock.
 */
export async function lockPlaced(tx: Transaction, appointmentId: string) {
  await tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(eq(appointment.id, appointmentId))
    .for("update");
  const [placed] = await tx
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      roomId: appointment.roomId,
      during: appointment.during,
      overbooking: appointment.overbooking,
      status: appointment.status,
      previousStatus: appointment.previousStatus,
      statusChangedAt: appointment.statusChangedAt,
      cancelledBy: appointment.cancelledBy,
      cancellationReason: appointment.cancellationReason,
      receptionNote: appointment.receptionNote,
      officeId: office.id,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(appointment.id, appointmentId));
  return placed;
}

type Placed = NonNullable<Awaited<ReturnType<typeof lockPlaced>>>;

/**
 * Moves a locked appointment where the placement says. Keeping the room it
 * already has is a success with no write and no audit entry.
 */
export async function movePlaced(
  tx: Transaction,
  actor: Actor,
  practitioner: { id: string },
  placed: Placed,
  { roomId }: Placement,
): Promise<{ ok: true } | RoomRefusal | { ok: false; reason: "otherOffice" }> {
  if (roomId === placed.roomId) {
    return { ok: true };
  }
  const space = await checkRoomSpace(tx, roomId, practitioner.id, placed.during);
  if (!space.ok) {
    return space;
  }
  if (space.officeId !== placed.officeId) {
    return { ok: false, reason: "otherOffice" };
  }
  const written = await writeRoomChange(tx, placed, roomId);
  if (!written.ok) {
    return written;
  }
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "appointment",
    entityId: placed.id,
    patientId: placed.patientId,
    before: { roomId: placed.roomId },
    after: { roomId },
  });
  return { ok: true };
}
