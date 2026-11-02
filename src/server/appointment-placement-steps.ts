import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { appointment, office, practitioner, room, schedule } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { coveringSchedule, occurrencesDuring } from "#/lib/availability.ts";
import { findCrowding } from "#/lib/room-space.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { findBlocking, findFreeTimes, meets, toAvailableStarts } from "#/server/availability.ts";
import type { AvailableStart } from "#/server/availability.ts";

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

/** Another appointment of the patient's that a booking warns about. */
export interface PatientWarning {
  kind: "overlap" | "sameDay";
  start: Date;
  end: Date;
  practitionerName: string;
  /** The zone of the appointment's office, to show it in local time. */
  timeZone: string;
}

export type TimeTaken = { ok: false; reason: "timeTaken"; freeStarts: AvailableStart[] };

export type WarningRefusal = { ok: false; reason: "patientWarning"; warnings: PatientWarning[] };

export type FreeStartPlacement = { kind: "freeStart"; span: TimeRange };
export type OverbookingPlacement = {
  kind: "overbooking";
  span: TimeRange;
  pickedRoomId: string | null;
};

export type BookablePractitioner = { id: string; gridMinutes: number };

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

/** What a status change leaves on the appointment. */
export interface NextStatus {
  status: AppointmentStatus;
  previousStatus: AppointmentStatus | null;
  cancelledBy: (typeof appointment.$inferSelect)["cancelledBy"];
  cancellationReason: string | null;
}

/**
 * Writes a status change. Only a change back to holding time can be turned down,
 * and the two constraints mean different things: the room's that another
 * practitioner took the room, the practitioner's that their own time is taken.
 */
export async function writeStatusRow(
  tx: Transaction,
  placed: { id: string; practitionerId: string; roomId: string; during: TimeRange },
  next: NextStatus,
): Promise<{ ok: true } | RoomRefusal | { ok: false; reason: "timeTaken" }> {
  const written = await updateRow(tx, placed.id, { ...next, statusChangedAt: new Date() });
  if (written.ok) {
    return written;
  }
  return written.constraint === "room"
    ? lostRoomRace(tx, placed.roomId, placed.practitionerId, placed.during)
    : { ok: false, reason: "timeTaken" };
}

function localDay(instant: Date, timeZone: string): TimeRange {
  const date = format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
  return toTimeRange({ kind: "days", firstDate: date, lastDate: date }, timeZone);
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The patient's active appointments on the local day of `span`, as warnings,
 * but for `excludeId`, the one being rescheduled.
 */
async function findPatientWarnings(
  tx: Transaction,
  patientId: string,
  span: TimeRange,
  timeZone: string,
  excludeId: string | undefined,
): Promise<PatientWarning[]> {
  const rows = await tx
    .select({
      during: appointment.during,
      practitionerName: practitioner.displayName,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        eq(appointment.patientId, patientId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment.during, localDay(span.start, timeZone)),
        excludeId === undefined ? undefined : ne(appointment.id, excludeId),
      ),
    )
    .orderBy(asc(appointment.during));
  return rows.map((row) => ({
    kind: intersects(row.during, span) ? "overlap" : "sameDay",
    start: row.during.start,
    end: row.during.end,
    practitionerName: row.practitionerName,
    timeZone: row.timeZone,
  }));
}

/**
 * The room of the free start at the start of `span`, which takes no room lock.
 * `excludeAppointmentId` is the one being moved, whose own time counts as free.
 */
async function placeFreeStart(
  tx: Transaction,
  bookable: BookablePractitioner,
  span: TimeRange,
  excludeAppointmentId: string | undefined,
): Promise<{ ok: true; roomId: string; timeZone: string } | { ok: false; reason: "notFree" }> {
  const { free, schedules } = await findFreeTimes(tx, bookable, {
    window: { start: span.start, end: new Date(+span.start + 1) },
    durationMinutes: (+span.end - +span.start) / 60_000,
    excludeAppointmentId,
  });
  const slot = free.find((candidate) => +candidate.start === +span.start);
  if (!slot) {
    return { ok: false, reason: "notFree" };
  }
  const { timeZone } = schedules.find((row) => row.roomId === slot.roomId)!;
  return { ok: true, roomId: slot.roomId, timeZone };
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
async function placeOverbooking(
  tx: Transaction,
  bookable: BookablePractitioner,
  span: TimeRange,
  picked: string | null,
): Promise<
  | { ok: true; roomId: string; timeZone: string }
  | RoomRefusal
  | { ok: false; reason: "roomRequired" | "timeOff" | "closed" }
> {
  const { schedules } = await findFreeTimes(tx, bookable, {
    window: span,
    durationMinutes: (+span.end - +span.start) / 60_000,
  });
  const roomId = picked ?? coveringSchedule(schedules, span)?.roomId;
  if (!roomId) {
    return { ok: false, reason: "roomRequired" };
  }
  const space = await checkRoomSpace(tx, roomId, bookable.id, span);
  if (!space.ok) {
    return space;
  }
  const blocked = await checkWorkingTime(tx, bookable.id, span, space.officeId);
  return blocked ?? { ok: true, roomId, timeZone: space.timeZone };
}

/**
 * Where a placement at a new time goes, and the patient's warnings about it
 * unless confirmed. `excludeAppointmentId` is the appointment being moved, which
 * does not compete with its own time or warn about itself.
 */
export async function resolveTime(
  tx: Transaction,
  bookable: BookablePractitioner,
  patientId: string,
  placement: FreeStartPlacement | OverbookingPlacement,
  confirmWarnings: boolean,
  excludeAppointmentId: string | undefined,
) {
  const { span } = placement;
  const where =
    placement.kind === "freeStart"
      ? await placeFreeStart(tx, bookable, span, excludeAppointmentId)
      : await placeOverbooking(tx, bookable, span, placement.pickedRoomId);
  if (!where.ok) {
    return where;
  }
  const warnings = confirmWarnings
    ? []
    : await findPatientWarnings(tx, patientId, span, where.timeZone, excludeAppointmentId);
  if (warnings.length > 0) {
    return { ok: false as const, reason: "patientWarning" as const, warnings };
  }
  return where;
}

/**
 * The refusal for a write at a new time that lost the race. A free start lost on
 * either constraint gets the free times of its local day to pick another. An
 * overbooking can lose only on the room's constraint, since its flag exempts it
 * from the practitioner's.
 */
async function refuseLostTime(
  tx: Transaction,
  bookable: BookablePractitioner,
  { roomId, during, overbooking }: { roomId: string; during: TimeRange; overbooking?: boolean },
  timeZone: string,
  excludeAppointmentId: string | undefined,
): Promise<TimeTaken | RoomRefusal> {
  if (overbooking) {
    return lostRoomRace(tx, roomId, bookable.id, during);
  }
  const fresh = await findFreeTimes(tx, bookable, {
    window: localDay(during.start, timeZone),
    durationMinutes: (+during.end - +during.start) / 60_000,
    excludeAppointmentId,
  });
  return {
    ok: false,
    reason: "timeTaken",
    freeStarts: toAvailableStarts(fresh.free, fresh.schedules),
  };
}

/** Writes a new appointment, recovering a lost race by `refuseLostTime`. */
export async function writeNewRow(
  tx: Transaction,
  bookable: BookablePractitioner,
  values: typeof appointment.$inferInsert,
  timeZone: string,
): Promise<{ ok: true; id: string } | TimeTaken | RoomRefusal> {
  const written = await insertRow(tx, values);
  return written.ok ? written : refuseLostTime(tx, bookable, values, timeZone, undefined);
}

/** Writes an appointment's move to a new time, recovering a lost race by `refuseLostTime`. */
export async function writeMovedRow(
  tx: Transaction,
  bookable: BookablePractitioner,
  appointmentId: string,
  values: { during: TimeRange; roomId: string; overbooking: boolean },
  timeZone: string,
): Promise<{ ok: true } | TimeTaken | RoomRefusal> {
  const written = await updateRow(tx, appointmentId, values);
  return written.ok ? written : refuseLostTime(tx, bookable, values, timeZone, appointmentId);
}
