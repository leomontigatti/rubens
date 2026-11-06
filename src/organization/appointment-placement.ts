import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { coveringSchedule, occurrencesDuring } from "#/lib/availability.ts";
import { findCrowding } from "#/lib/room-space.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { asRange, findBlocking, findFreeTimes, meets } from "#/organization/availability.ts";
import type { Writer } from "#/organization/database.ts";
import { appointment, office, practitioner, room, schedule } from "#/organization/schema.ts";

// Where an appointment at a new time goes, and whether it may (ADR-0003,
// docs/domain/appointments.md § Booking). Both overlap rules are checks here,
// read in the same synchronous transaction as the write that follows them
// (ADR-0008), so nothing can book in between:
//
// - a booking at a free start: the practitioner's free times already leave out
//   their own active appointments and the rooms other practitioners'
//   appointments hold (`findFreeTimes`);
// - an overbooking skips the free times and the practitioner's own overlap, but
//   still needs a room with space (`checkRoomSpace`) and working time.
//
// Then the patient's other appointments that day warn until confirmed.

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
interface PatientWarning {
  kind: "overlap" | "sameDay";
  start: Date;
  end: Date;
  practitionerName: string;
  /** The zone of the appointment's office, to show it in local time. */
  timeZone: string;
}

type WarningRefusal = { ok: false; reason: "patientWarning"; warnings: PatientWarning[] };

export type NewPlacement =
  | { kind: "freeStart"; span: TimeRange }
  | { kind: "overbooking"; span: TimeRange; pickedRoomId: string | null };

type Placed = { ok: true; roomId: string; timeZone: string };

/** Why a placement of that kind was refused, so a screen's copy map covers each. */
export type PlacementRefusal<Kind extends NewPlacement["kind"]> = Kind extends "freeStart"
  ? WarningRefusal | { ok: false; reason: "notFree" }
  : WarningRefusal | RoomRefusal | { ok: false; reason: "roomRequired" | "timeOff" | "closed" };

const intersects = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;

/** Every practitioner in the room during `span`, through a schedule or an active appointment. */
function findPresences(writer: Writer, roomId: string, span: TimeRange, timeZone: string) {
  const schedules = writer
    .select({
      practitionerId: schedule.practitionerId,
      practitionerName: practitioner.displayName,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .where(eq(schedule.roomId, roomId))
    .all();
  const appointments = writer
    .select({
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .where(
      and(
        eq(appointment.roomId, roomId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment, span),
      ),
    )
    .all();
  return [
    ...schedules.flatMap(({ practitionerId, practitionerName, ...slot }) =>
      occurrencesDuring({ ...slot, timeZone }, span).map((occurrence) => ({
        practitionerId,
        practitionerName,
        kind: "schedule" as const,
        ...occurrence,
      })),
    ),
    ...appointments.map(({ practitionerId, practitionerName, ...row }) => ({
      practitionerId,
      practitionerName,
      kind: "appointment" as const,
      ...asRange(row),
    })),
  ];
}

/**
 * Whether the room has space for the practitioner during `span`: no other
 * practitioner's active appointment there meets it, and its capacity holds them.
 */
export function checkRoomSpace(
  writer: Writer,
  roomId: string,
  practitionerId: string,
  span: TimeRange,
): { ok: true; officeId: string; timeZone: string } | RoomRefusal {
  const target = writer
    .select({
      officeId: room.officeId,
      active: room.active,
      capacity: room.capacity,
      officeActive: office.active,
      timeZone: office.timeZone,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, roomId))
    .get();
  if (!target) {
    return { ok: false, reason: "notFound" };
  }
  if (!target.officeActive) {
    return { ok: false, reason: "officeInactive" };
  }
  if (!target.active) {
    return { ok: false, reason: "roomInactive" };
  }
  const presences = findPresences(writer, roomId, span, target.timeZone);
  // Another practitioner's appointment holds the room whatever its capacity.
  const held = presences.filter(
    (presence) =>
      presence.kind === "appointment" &&
      presence.practitionerId !== practitionerId &&
      intersects(presence, span),
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

function localDay(instant: Date, timeZone: string): TimeRange {
  const date = format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
  return toTimeRange({ kind: "days", firstDate: date, lastDate: date }, timeZone);
}

/**
 * The patient's active appointments on the local day of `span`, as warnings,
 * but for `excludeId`, the one being rescheduled.
 */
function findPatientWarnings(
  writer: Writer,
  patientId: string,
  span: TimeRange,
  timeZone: string,
  excludeId: string | undefined,
): PatientWarning[] {
  const rows = writer
    .select({
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
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
        meets(appointment, localDay(span.start, timeZone)),
        excludeId === undefined ? undefined : ne(appointment.id, excludeId),
      ),
    )
    .orderBy(asc(appointment.startsAt))
    .all();
  return rows.map(({ startsAt, endsAt, practitionerName, timeZone: zone }) => {
    const during = asRange({ startsAt, endsAt });
    return {
      kind: intersects(during, span) ? "overlap" : "sameDay",
      ...during,
      practitionerName,
      timeZone: zone,
    };
  });
}

/**
 * The room of the practitioner's free start at the start of `span`.
 * `excludeAppointmentId` is the one being moved, whose own time counts as free.
 */
function placeFreeStart(
  writer: Writer,
  bookable: { id: string; gridMinutes: number },
  span: TimeRange,
  excludeAppointmentId: string | undefined,
): Placed | { ok: false; reason: "notFree" } {
  const { free, schedules } = findFreeTimes(writer, bookable, {
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

/**
 * The room an overbooking goes in: the one picked, or else the schedule's it
 * falls inside, when that room has space and the practitioner works then.
 */
function placeOverbooking(
  writer: Writer,
  bookable: { id: string; gridMinutes: number },
  span: TimeRange,
  picked: string | null,
): Placed | PlacementRefusal<"overbooking"> {
  const { schedules } = findFreeTimes(writer, bookable, {
    window: span,
    durationMinutes: (+span.end - +span.start) / 60_000,
  });
  const roomId = picked ?? coveringSchedule(schedules, span)?.roomId;
  if (!roomId) {
    return { ok: false, reason: "roomRequired" };
  }
  const space = checkRoomSpace(writer, roomId, bookable.id, span);
  if (!space.ok) {
    return space;
  }
  const blocking = findBlocking(writer, bookable.id, span, [space.officeId]);
  if (blocking.timeOff.length > 0) {
    return { ok: false, reason: "timeOff" };
  }
  if (blocking.closures.length > 0) {
    return { ok: false, reason: "closed" };
  }
  return { ok: true, roomId, timeZone: space.timeZone };
}

/**
 * Where an appointment at the placement's time goes, and the patient's
 * warnings about it unless `confirmWarnings`. `excludeAppointmentId` is the
 * appointment being moved, which does not compete with its own time or warn
 * about itself; a new one has none.
 */
export function placeAtTime<Kind extends NewPlacement["kind"]>(
  writer: Writer,
  bookable: { id: string; gridMinutes: number },
  patientId: string,
  placement: Extract<NewPlacement, { kind: Kind }>,
  confirmWarnings: boolean,
  excludeAppointmentId?: string,
): Placed | PlacementRefusal<Kind>;
export function placeAtTime(
  writer: Writer,
  bookable: { id: string; gridMinutes: number },
  patientId: string,
  placement: NewPlacement,
  confirmWarnings: boolean,
  excludeAppointmentId?: string,
): Placed | PlacementRefusal<NewPlacement["kind"]> {
  const { span } = placement;
  const where =
    placement.kind === "freeStart"
      ? placeFreeStart(writer, bookable, span, excludeAppointmentId)
      : placeOverbooking(writer, bookable, span, placement.pickedRoomId);
  if (!where.ok) {
    return where;
  }
  const warnings = confirmWarnings
    ? []
    : findPatientWarnings(writer, patientId, span, where.timeZone, excludeAppointmentId);
  if (warnings.length > 0) {
    return { ok: false, reason: "patientWarning", warnings };
  }
  return where;
}
