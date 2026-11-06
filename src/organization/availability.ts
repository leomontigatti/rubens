import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import { availabilityQuerySchema, findFreeStarts } from "#/lib/availability.ts";
import type { AvailabilityClosure, AvailabilityQuery, FreeStart } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import type { SchedulePractitioner } from "#/organization/practitioners.ts";
import {
  closure,
  member,
  office,
  practitioner,
  room,
  schedule,
  timeOff,
} from "#/organization/schema.ts";

// A practitioner's free times (ui: "Disponibilidad"): the stored schedules,
// time off and closures, handed to the pure module in `#/lib/availability.ts`.
// Reception and admins read anyone's; a practitioner reads their own. The
// dates asked for are read in the organization's default zone. Schedules in a
// deactivated room or office offer nothing. Booked appointments are not
// subtracted yet: they port with booking (#137).

export interface AvailableStart {
  start: Date;
  officeName: string;
  roomName: string;
  /** The office's zone, to show the start in local time. */
  timeZone: string;
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

/** The active practitioners whose free times `acting` may read. */
export function listAvailabilityPractitioners(
  writer: Writer,
  acting: Acting,
): { ok: true; practitioners: SchedulePractitioner[] } {
  const rows = writer
    .select({
      id: practitioner.id,
      displayName: practitioner.displayName,
      userId: member.userId,
      roles: member.roles,
    })
    .from(practitioner)
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(eq(member.active, true))
    .orderBy(asc(practitioner.displayName))
    .all();
  return {
    ok: true,
    practitioners: rows
      .filter((row) => row.roles.includes("practitioner"))
      .filter((row) => actsForEveryone(acting) || row.userId === acting.userId)
      .map(({ id, displayName }) => ({ id, displayName })),
  };
}

/** Rows whose span `[startsAt, endsAt)` meets `range`. */
function meets(table: typeof timeOff | typeof closure, range: TimeRange) {
  return and(lt(table.startsAt, +range.end), gt(table.endsAt, +range.start));
}

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
}

const asRange = (row: { startsAt: number; endsAt: number }): TimeRange => ({
  start: new Date(row.startsAt),
  end: new Date(row.endsAt),
});

/**
 * The practitioner's time off that meets `range`, and the closures that meet
 * it of the organization and of the offices `officeIds`.
 */
function findBlocking(
  writer: Writer,
  practitionerId: string,
  range: TimeRange,
  officeIds: readonly string[],
): { timeOff: TimeRange[]; closures: AvailabilityClosure[] } {
  const timeOffRows = writer
    .select({ startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
    .from(timeOff)
    .where(and(eq(timeOff.practitionerId, practitionerId), meets(timeOff, range)))
    .all();
  const closureRows = writer
    .select({ officeId: closure.officeId, startsAt: closure.startsAt, endsAt: closure.endsAt })
    .from(closure)
    .where(
      and(
        officeIds.length > 0
          ? or(isNull(closure.officeId), inArray(closure.officeId, [...officeIds]))
          : isNull(closure.officeId),
        meets(closure, range),
      ),
    )
    .all();
  return {
    timeOff: timeOffRows.map(asRange),
    closures: closureRows.map((row) => ({ officeId: row.officeId, during: asRange(row) })),
  };
}

/**
 * The practitioner's free starts of `durationMinutes` inside `window`, with
 * their office's and room's names.
 */
function findFreeTimes(
  writer: Writer,
  owner: { id: string; gridMinutes: number },
  window: TimeRange,
  durationMinutes: number,
): AvailableStart[] {
  // A start near the window's end runs past it by up to the duration.
  const reach = { start: window.start, end: new Date(+window.end + durationMinutes * 60_000) };
  // An office in another zone than the default one sees the window a day
  // earlier or later, so the dates are widened by a day each way.
  const firstDate = shiftDate(localDate(window.start, defaultTimeZone), -1);
  const lastDate = shiftDate(localDate(reach.end, defaultTimeZone), 1);
  const schedules = writer
    .select({
      officeId: office.id,
      officeName: office.name,
      timeZone: office.timeZone,
      roomId: room.id,
      roomName: room.name,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(room, and(eq(room.id, schedule.roomId), eq(room.active, true)))
    .innerJoin(office, and(eq(office.id, room.officeId), eq(office.active, true)))
    .where(
      and(
        eq(schedule.practitionerId, owner.id),
        lte(schedule.firstDate, lastDate),
        or(isNull(schedule.lastDate), gte(schedule.lastDate, firstDate)),
      ),
    )
    .all();
  const blocking = findBlocking(writer, owner.id, reach, [
    ...new Set(schedules.map((row) => row.officeId)),
  ]);
  const free: FreeStart[] = findFreeStarts({
    schedules,
    ...blocking,
    busy: [],
    roomBusy: [],
    gridMinutes: owner.gridMinutes,
    window,
    durationMinutes,
  });
  const rooms = new Map(schedules.map((row) => [row.roomId, row]));
  return free.map(({ start, roomId }) => {
    const where = rooms.get(roomId)!;
    return {
      start,
      officeName: where.officeName,
      roomName: where.roomName,
      timeZone: where.timeZone,
    };
  });
}

/** The practitioner's free starts from the first to the last date, for the duration. */
export function getAvailability(
  writer: Writer,
  acting: Acting,
  input: AvailabilityQuery,
): Result<{
  practitioner: SchedulePractitioner;
  gridMinutes: number;
  freeStarts: AvailableStart[];
}> {
  const parsed = availabilityQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { practitionerId, firstDate, lastDate, durationMinutes } = parsed.data;
  const found = findPractitioner(writer, acting, practitionerId);
  if (!found) {
    return { ok: false, reason: "notFound" };
  }
  if (!actsForEveryone(acting) && !found.canEdit) {
    return { ok: false, reason: "forbidden" };
  }
  const window = toTimeRange({ kind: "days", firstDate, lastDate }, defaultTimeZone);
  return {
    ok: true,
    practitioner: { id: found.id, displayName: found.displayName },
    gridMinutes: found.gridMinutes,
    freeStarts: findFreeTimes(writer, found, window, durationMinutes),
  };
}
