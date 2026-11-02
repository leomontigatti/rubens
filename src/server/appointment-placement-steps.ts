import { and, eq, inArray } from "drizzle-orm";

import { appointment, office, practitioner, room, schedule } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { findCrowding } from "#/lib/room-space.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { meets } from "#/server/availability.ts";

// The steps behind appointment placement (`appointment-placement.ts`, whose top
// comment gives their sequence). Only that module and its tests call them: the
// tests reach the write step here because PGlite runs one connection, so no
// service can lose a race there.

/** What holds a room when it has no space: a schedule or an appointment, and whose. */
export interface RoomOccupant {
  practitionerName: string;
  kind: "schedule" | "appointment";
  start: Date;
  end: Date;
}

export type RoomRefusal =
  | { ok: false; reason: "notFound" | "roomInactive" | "officeInactive" }
  | { ok: false; reason: "roomFull"; occupants: RoomOccupant[] };

/** Which exclusion constraint turned a write down. */
type LostConstraint = { ok: false; constraint: "practitioner" | "room" };

/** The constraint `error`, or an error it wraps, is a violation of, if one of the overlap two. */
function firedConstraint(error: unknown): LostConstraint | null {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ("constraint" in cause) {
      if (cause.constraint === "appointment_practitioner_overlap") {
        return { ok: false, constraint: "practitioner" };
      }
      if (cause.constraint === "appointment_room_overlap") {
        return { ok: false, constraint: "room" };
      }
    }
  }
  return null;
}

/**
 * Inserts an appointment in a savepoint, so a write that lost the race keeps
 * its transaction and can read what it needs to say why.
 */
export async function insertRow(
  tx: Transaction,
  values: typeof appointment.$inferInsert,
): Promise<{ ok: true; id: string } | LostConstraint> {
  try {
    const [created] = await tx.transaction((savepoint) =>
      savepoint.insert(appointment).values(values).returning({ id: appointment.id }),
    );
    return { ok: true, id: created!.id };
  } catch (error) {
    const lost = firedConstraint(error);
    if (lost) {
      return lost;
    }
    throw error;
  }
}

/** Updates an appointment in a savepoint, as `insertRow` inserts one. */
export async function updateRow(
  tx: Transaction,
  appointmentId: string,
  values: Partial<typeof appointment.$inferInsert>,
): Promise<{ ok: true } | LostConstraint> {
  try {
    await tx.transaction((savepoint) =>
      savepoint
        .update(appointment)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(appointment.id, appointmentId)),
    );
    return { ok: true };
  } catch (error) {
    const lost = firedConstraint(error);
    if (lost) {
      return lost;
    }
    throw error;
  }
}

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
 * Whether the room has space for the practitioner during `span`: no other
 * practitioner's appointment there meets it, and its capacity holds them. Locks the
 * room row for the rest of the transaction, so two checks of one room run one
 * after the other. `no key update` leaves the key-share lock an appointment's
 * foreign key takes free: a plain booking never waits on this lock, which
 * would close a deadlock with the exclusion constraint.
 */
export async function checkRoomSpace(
  tx: Transaction,
  roomId: string,
  practitionerId: string,
  span: TimeRange,
): Promise<{ ok: true; officeId: string; timeZone: string } | RoomRefusal> {
  await tx.select({ id: room.id }).from(room).where(eq(room.id, roomId)).for("no key update");
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
  // Another practitioner's appointment holds the room whatever its capacity.
  const held = presences.filter(
    (presence) =>
      presence.kind === "appointment" &&
      presence.practitionerId !== practitionerId &&
      presence.start < span.end &&
      span.start < presence.end,
  );
  const crowding =
    held.length > 0 ? held : findCrowding(span, practitionerId, presences, target.capacity);
  if (crowding) {
    const occupants = crowding
      .map(({ practitionerName, kind, start, end }) => ({ practitionerName, kind, start, end }))
      .sort((a, b) => +a.start - +b.start || a.practitionerName.localeCompare(b.practitionerName));
    return { ok: false, reason: "roomFull", occupants };
  }
  return { ok: true, officeId: target.officeId, timeZone: target.timeZone };
}

/**
 * The refusal for a write the room's constraint turned down: another
 * practitioner's appointment there was committed after `checkRoomSpace` ran,
 * and a second check now sees and names it.
 */
export async function lostRoomRace(
  tx: Transaction,
  roomId: string,
  practitionerId: string,
  span: TimeRange,
): Promise<RoomRefusal> {
  const space = await checkRoomSpace(tx, roomId, practitionerId, span);
  return space.ok ? { ok: false, reason: "roomFull", occupants: [] } : space;
}

/**
 * Writes an appointment's move to another room at the same time. Its time does
 * not change, so only the room's constraint can turn the write down.
 */
export async function writeRoomChange(
  tx: Transaction,
  placed: { id: string; practitionerId: string; during: TimeRange },
  roomId: string,
): Promise<{ ok: true } | RoomRefusal> {
  const written = await updateRow(tx, placed.id, { roomId });
  return written.ok ? written : lostRoomRace(tx, roomId, placed.practitionerId, placed.during);
}
