import { and, count, eq, inArray } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import { activeAppointmentStatuses, mondayOf } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { meets } from "#/organization/availability.ts";
import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { appointment, practitioner, schedule } from "#/organization/schema.ts";

// Where the calendar opens for a practitioner who does not book for everyone
// (docs/domain/appointments.md § Calendar): on themselves, in the room with
// most of their active appointments that week, else a room they are scheduled
// in that week. `roomIds` are the active rooms in the order the calendar lists
// them, which settles a tie. Rooms of several zones share one week here, in the
// default zone: it only picks where to open.

/** How many of the practitioner's active appointments each room holds that week. */
function countByRoom(
  writer: Writer,
  practitionerId: string,
  roomIds: readonly string[],
  week: TimeRange,
) {
  const rows = writer
    .select({ roomId: appointment.roomId, total: count() })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, practitionerId),
        inArray(appointment.roomId, [...roomIds]),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment, week),
      ),
    )
    .groupBy(appointment.roomId)
    .all();
  return new Map(rows.map((row) => [row.roomId, row.total]));
}

/** The rooms where the practitioner has a schedule with a day that week. */
function scheduledRooms(
  writer: Writer,
  practitionerId: string,
  roomIds: readonly string[],
  week: TimeRange,
) {
  const rows = writer
    .select({
      roomId: schedule.roomId,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .where(and(eq(schedule.practitionerId, practitionerId), inArray(schedule.roomId, [...roomIds])))
    .all();
  const held = rows.filter(
    (row) => occurrencesDuring({ ...row, timeZone: defaultTimeZone }, week).length > 0,
  );
  return new Set(held.map((row) => row.roomId));
}

/** Who the calendar opens on and where; `undefined` when `acting` keeps the default. */
export function findCalendarOpening(
  writer: Writer,
  acting: Acting,
  date: string,
  roomIds: readonly string[],
) {
  if (actsForEveryone(acting) || roomIds.length === 0) {
    return undefined;
  }
  const own = writer
    .select({ id: practitioner.id })
    .from(practitioner)
    .where(eq(practitioner.memberId, acting.userId))
    .get();
  if (!own) {
    return undefined;
  }
  const firstDate = mondayOf(date);
  const week = toTimeRange(
    { kind: "days", firstDate, lastDate: shiftDate(firstDate, 6) },
    defaultTimeZone,
  );
  const counts = countByRoom(writer, own.id, roomIds, week);
  if (counts.size > 0) {
    const most = Math.max(...counts.values());
    return { practitionerId: own.id, roomId: roomIds.find((id) => counts.get(id) === most) };
  }
  const scheduled = scheduledRooms(writer, own.id, roomIds, week);
  return { practitionerId: own.id, roomId: roomIds.find((id) => scheduled.has(id)) };
}
