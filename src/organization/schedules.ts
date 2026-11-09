import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, gt, inArray, ne, or } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { findCrowding } from "#/lib/room-space.ts";
import {
  findCollision,
  sameClock,
  scheduleChangeSchema,
  scheduleDeleteSchema,
  scheduleEndSchema,
  scheduleInputSchema,
  sharedDates,
  shiftDate,
  shortTime,
  today,
} from "#/lib/schedules.ts";
import type {
  ScheduleChange,
  ScheduleDelete,
  ScheduleEnd,
  ScheduleInput,
  WeeklySlot,
} from "#/lib/schedules.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { recordAudit } from "#/organization/audit.ts";
import { settlingToReschedule } from "#/organization/change-messages.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import type { SchedulePractitioner } from "#/organization/practitioners.ts";
import { appointment, office, practitioner, room, schedule } from "#/organization/schema.ts";

// Practitioners' weekly schedules. Everyone reads them; an admin changes
// anyone's and a practitioner their own (the object requires one of the two
// roles, and `findPractitioner` decides whose). Saving one checks that the
// room never holds more practitioners at once than its capacity, through
// schedules or future appointments, and the practitioner is never in two
// schedules at once (ADR-0003). The check and the write run in one
// synchronous transaction, so no other call interleaves (ADR-0008). Every
// change is written to the audit log, about no patient.

export interface Schedule {
  id: string;
  roomId: string;
  roomName: string;
  officeName: string;
  timeZone: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  firstDate: string;
  lastDate: string | null;
}

/** An active room in an active office, where a schedule can be saved. */
export interface RoomOption {
  id: string;
  name: string;
  officeName: string;
}

/** The schedule a save collides with, and on which weekday. */
export interface Collision {
  practitionerName: string;
  roomName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Another practitioner's appointment that fills the room a save would add to. */
export interface AppointmentCollision {
  practitionerName: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
}

type Refusal =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "practitionerInactive"
  | "roomInactive"
  | "officeInactive"
  | "dateInPast"
  | "alreadyStarted"
  | "otherTimeZone";

type CollisionRefusal =
  | { ok: false; reason: "roomFull" | "practitionerBusy"; collision: Collision }
  | { ok: false; reason: "roomFull"; appointment: AppointmentCollision };

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

type SaveResult<T> = Result<T> | CollisionRefusal;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const practitionerInactive = { ok: false, reason: "practitionerInactive" } as const;
const dateInPast = { ok: false, reason: "dateInPast" } as const;

const scheduleColumns = {
  id: schedule.id,
  practitionerId: schedule.practitionerId,
  roomId: schedule.roomId,
  roomName: room.name,
  officeName: office.name,
  timeZone: office.timeZone,
  weekdays: schedule.weekdays,
  startTime: schedule.startTime,
  endTime: schedule.endTime,
  firstDate: schedule.firstDate,
  lastDate: schedule.lastDate,
};

type ScheduleRow = Schedule & { practitionerId: string };

function selectSchedules(writer: Writer) {
  return writer
    .select(scheduleColumns)
    .from(schedule)
    .innerJoin(room, eq(room.id, schedule.roomId))
    .innerJoin(office, eq(office.id, room.officeId));
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    officeName: row.officeName,
    timeZone: row.timeZone,
    weekdays: row.weekdays,
    startTime: shortTime(row.startTime),
    endTime: shortTime(row.endTime),
    firstDate: row.firstDate,
    lastDate: row.lastDate,
  };
}

/** A schedule's stored fields as the audit log keeps them: the weekdays as "1,3". */
function auditedFields(fields: Partial<Candidate>) {
  const { weekdays, ...rest } = fields;
  return weekdays === undefined ? rest : { ...rest, weekdays: weekdays.join(",") };
}

/** A practitioner's schedules, ended ones included, and the rooms a new one can use. */
export function getPractitionerSchedules(
  database: Database,
  acting: Acting,
  input: { practitionerId: string },
): Result<{
  practitioner: SchedulePractitioner & { canEdit: boolean; active: boolean };
  schedules: Schedule[];
  rooms: RoomOption[];
}> {
  const found = findPractitioner(database, acting, input.practitionerId);
  if (!found) {
    return notFound;
  }
  const rows = selectSchedules(database)
    .where(eq(schedule.practitionerId, found.id))
    .orderBy(asc(schedule.firstDate), asc(schedule.startTime))
    .all();
  const rooms = database
    .select({ id: room.id, name: room.name, officeName: office.name })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(and(eq(room.active, true), eq(office.active, true)))
    .orderBy(asc(office.name), asc(room.name))
    .all();
  return {
    ok: true,
    practitioner: {
      id: found.id,
      displayName: found.displayName,
      canEdit: found.canEdit,
      active: found.active,
    },
    schedules: rows.map(toSchedule),
    rooms,
  };
}

/** A schedule about to be saved: who, where and when. */
type Candidate = Omit<WeeklySlot, "weekdays"> & {
  weekdays: number[];
  practitionerId: string;
  roomId: string;
};

function describeCollision(row: ScheduleRow & { practitionerName: string }, weekday: number) {
  return {
    practitionerName: row.practitionerName,
    roomName: row.roomName,
    weekday,
    startTime: shortTime(row.startTime),
    endTime: shortTime(row.endTime),
  };
}

/** Checks `candidate` against the room and the practitioner's other schedules, all but `replacing`. */
function checkCandidate(
  writer: Writer,
  candidate: Candidate,
  replacing: string | null,
): { ok: true } | { ok: false; reason: Refusal } | CollisionRefusal {
  const target = writer
    .select({
      name: room.name,
      active: room.active,
      capacity: room.capacity,
      officeActive: office.active,
      timeZone: office.timeZone,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, candidate.roomId))
    .get();
  if (!target) {
    return notFound;
  }
  if (!target.officeActive) {
    return { ok: false, reason: "officeInactive" };
  }
  if (!target.active) {
    return { ok: false, reason: "roomInactive" };
  }

  const others = writer
    .select({ ...scheduleColumns, practitionerName: practitioner.displayName })
    .from(schedule)
    .innerJoin(room, eq(room.id, schedule.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .where(
      and(
        or(
          eq(schedule.roomId, candidate.roomId),
          eq(schedule.practitionerId, candidate.practitionerId),
        ),
        replacing === null ? undefined : ne(schedule.id, replacing),
      ),
    )
    .all();

  // The collision check compares local times, which only means one moment within
  // one clock, so a practitioner works on a single clock at a time.
  const abroad = others.some((row) => {
    const shared = sharedDates(row, candidate);
    return (
      row.practitionerId === candidate.practitionerId &&
      shared !== null &&
      !sameClock(row.timeZone, target.timeZone, shared, today(target.timeZone))
    );
  });
  if (abroad) {
    return { ok: false, reason: "otherTimeZone" };
  }

  const inRoom = others.filter((row) => row.roomId === candidate.roomId);
  const roomClash = findCollision(candidate, inRoom, target.capacity);
  if (roomClash) {
    return {
      ok: false,
      reason: "roomFull",
      collision: describeCollision(roomClash.schedule, roomClash.weekday),
    };
  }
  const crowded = findCrowdedAppointment(writer, candidate, inRoom, target);
  if (crowded) {
    return { ok: false, reason: "roomFull", appointment: crowded };
  }
  const ownClash = findCollision(
    candidate,
    others.filter((row) => row.practitionerId === candidate.practitionerId),
    1,
  );
  if (ownClash) {
    return {
      ok: false,
      reason: "practitionerBusy",
      collision: describeCollision(ownClash.schedule, ownClash.weekday),
    };
  }
  return { ok: true };
}

/**
 * Another practitioner's future active appointment in the room that, with the
 * room's schedules and appointments, leaves no space for `candidate`; `null`
 * when there is none. `roomSchedules` excludes the one being replaced.
 */
function findCrowdedAppointment(
  writer: Writer,
  candidate: Candidate,
  roomSchedules: readonly ScheduleRow[],
  target: { name: string; capacity: number; timeZone: string },
): AppointmentCollision | null {
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
        eq(appointment.roomId, candidate.roomId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        gt(appointment.endsAt, Date.now()),
      ),
    )
    .all()
    .map(({ startsAt, endsAt, ...rest }) => ({
      ...rest,
      during: { start: new Date(startsAt), end: new Date(endsAt) },
    }));
  const presences = (span: TimeRange) => [
    ...roomSchedules.flatMap((row) =>
      occurrencesDuring(row, span).map((occurrence) => ({
        practitionerId: row.practitionerId,
        ...occurrence,
      })),
    ),
    ...appointments.map(({ practitionerId, during }) => ({ practitionerId, ...during })),
  ];
  const slot = { ...candidate, timeZone: target.timeZone };
  for (const held of appointments) {
    if (held.practitionerId === candidate.practitionerId) {
      continue;
    }
    for (const occurrence of occurrencesDuring(slot, held.during)) {
      const span = {
        start: occurrence.start > held.during.start ? occurrence.start : held.during.start,
        end: occurrence.end < held.during.end ? occurrence.end : held.during.end,
      };
      if (findCrowding(span, candidate.practitionerId, presences(span), target.capacity)) {
        const local = (instant: Date, pattern: string) =>
          format(instant, pattern, { in: tz(target.timeZone) });
        return {
          practitionerName: held.practitionerName,
          roomName: target.name,
          date: local(held.during.start, "yyyy-MM-dd"),
          startTime: local(held.during.start, "HH:mm"),
          endTime: local(held.during.end, "HH:mm"),
        };
      }
    }
  }
  return null;
}

function insertSchedule(writer: Writer, acting: Acting, candidate: Candidate) {
  const created = writer.insert(schedule).values(candidate).returning({ id: schedule.id }).get();
  recordAudit(writer, acting.userId, {
    action: "create",
    entityType: "schedule",
    entityId: created.id,
    patientId: null,
    before: null,
    after: createdFields(auditedFields(candidate)),
  });
  return created;
}

/** Writes `fields` over the schedule `current`, with its audit entry when anything changed. */
function updateSchedule(
  writer: Writer,
  acting: Acting,
  current: ScheduleRow,
  fields: Partial<Candidate>,
) {
  writer.update(schedule).set(fields).where(eq(schedule.id, current.id)).run();
  const changed = changedFields(auditedFields(current), auditedFields(fields));
  if (changed) {
    recordAudit(writer, acting.userId, {
      action: "update",
      entityType: "schedule",
      entityId: current.id,
      patientId: null,
      ...changed,
    });
  }
}

export function createSchedule(
  database: Database,
  acting: Acting,
  input: ScheduleInput,
): SaveResult<{ schedule: { id: string } }> {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const candidate = parsed.data;
  return database.transaction((tx) => {
    const owner = findPractitioner(tx, acting, candidate.practitionerId);
    if (!owner) {
      return notFound;
    }
    if (!owner.canEdit) {
      return forbidden;
    }
    if (!owner.active) {
      return practitionerInactive;
    }
    const checked = checkCandidate(tx, candidate, null);
    if (!checked.ok) {
      return checked;
    }
    return {
      ok: true as const,
      schedule: settlingToReschedule(tx, [owner.id], true, () =>
        insertSchedule(tx, acting, candidate),
      ),
    };
  });
}

/**
 * The schedule and its practitioner, when `acting` may change it. Past weeks
 * are judged by today's date in the schedule's office's zone.
 */
function findEditable(writer: Writer, acting: Acting, scheduleId: string) {
  const found = selectSchedules(writer).where(eq(schedule.id, scheduleId)).get();
  if (!found) {
    return notFound;
  }
  const owner = findPractitioner(writer, acting, found.practitionerId);
  if (!owner) {
    return notFound;
  }
  if (!owner.canEdit) {
    return forbidden;
  }
  return { ok: true as const, found, owner, today: today(found.timeZone) };
}

/**
 * Applies new fields from `from` on. A schedule that has started ends the day
 * before `from` and a new one carries the fields, so past weeks are never
 * rewritten; one that has not started is edited in place, its first date
 * becoming `from`.
 */
export function changeSchedule(
  database: Database,
  acting: Acting,
  input: ScheduleChange,
): SaveResult<{ schedule: { id: string } }> {
  const parsed = scheduleChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { scheduleId, from, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const editable = findEditable(tx, acting, scheduleId);
    if (!editable.ok) {
      return editable;
    }
    const { found, owner } = editable;
    if (from < editable.today) {
      return dateInPast;
    }
    if (found.lastDate !== null && from > found.lastDate) {
      return invalidInput;
    }
    if (!owner.active) {
      return practitionerInactive;
    }
    const candidate = { ...fields, practitionerId: owner.id, firstDate: from };
    // The old schedule ends before `from` in either case, so it never meets
    // the candidate and is left out of the check.
    const checked = checkCandidate(tx, candidate, found.id);
    if (!checked.ok) {
      return checked;
    }
    const started = found.firstDate <= editable.today && found.firstDate < from;
    return settlingToReschedule(tx, [owner.id], true, () => {
      if (!started) {
        updateSchedule(tx, acting, found, candidate);
        return { ok: true as const, schedule: { id: found.id } };
      }
      updateSchedule(tx, acting, found, { lastDate: shiftDate(from, -1) });
      return { ok: true as const, schedule: insertSchedule(tx, acting, candidate) };
    });
  });
}

/**
 * Sets the last date a schedule applies. Ending only shortens it, so it needs
 * no collision check; it can end yesterday at the earliest.
 */
export function endSchedule(
  database: Database,
  acting: Acting,
  input: ScheduleEnd,
): Result<object> {
  const parsed = scheduleEndSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { scheduleId, lastDate } = parsed.data;
  return database.transaction((tx) => {
    const editable = findEditable(tx, acting, scheduleId);
    if (!editable.ok) {
      return editable;
    }
    const { found } = editable;
    if (lastDate < shiftDate(editable.today, -1)) {
      return dateInPast;
    }
    const extends_ = found.lastDate !== null && lastDate > found.lastDate;
    if (lastDate < found.firstDate || extends_) {
      return invalidInput;
    }
    settlingToReschedule(tx, [found.practitionerId], true, () =>
      updateSchedule(tx, acting, found, { lastDate }),
    );
    return { ok: true as const };
  });
}

/** Deletes a schedule that has not started; a started one keeps its record. */
export function deleteSchedule(
  database: Database,
  acting: Acting,
  input: ScheduleDelete,
): Result<object> {
  const parsed = scheduleDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    const editable = findEditable(tx, acting, parsed.data.scheduleId);
    if (!editable.ok) {
      return editable;
    }
    const { found } = editable;
    if (found.firstDate <= editable.today) {
      return { ok: false as const, reason: "alreadyStarted" as const };
    }
    settlingToReschedule(tx, [found.practitionerId], true, () =>
      tx.delete(schedule).where(eq(schedule.id, found.id)).run(),
    );
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "schedule",
      entityId: found.id,
      patientId: null,
      before: createdFields(
        auditedFields({
          practitionerId: found.practitionerId,
          roomId: found.roomId,
          weekdays: found.weekdays,
          startTime: found.startTime,
          endTime: found.endTime,
          firstDate: found.firstDate,
          lastDate: found.lastDate,
        }),
      ),
      after: null,
    });
    return { ok: true as const };
  });
}
