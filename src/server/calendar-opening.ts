import { and, count, eq, inArray } from "drizzle-orm";

import { appointment, member, practitioner, schedule } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { activeAppointmentStatuses, mondayOf } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { meets } from "#/server/availability.ts";

// Where the calendar opens for a practitioner who does not book for everyone
// (docs/domain/appointments.md § Calendar): on themselves, in the room with
// most of their active appointments that week, else a room they are scheduled
// in that week. `roomIds` are the active rooms in the order the calendar lists
// them, which settles a tie. Rooms of several zones share one week here, in the
// default zone: it only picks where to open.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// the query on it names the actor's organization itself.

/** The actor's practitioner, when they only see their own appointments. */
async function findOwnPractitioner(tx: Transaction, actor: Actor) {
  if (actsForEveryone(actor)) {
    return undefined;
  }
  const [found] = await tx
    .select({ id: practitioner.id })
    .from(practitioner)
    .innerJoin(
      member,
      and(eq(member.id, practitioner.memberId), eq(member.organizationId, actor.organizationId)),
    )
    .where(eq(member.userId, actor.userId));
  return found?.id;
}

/** How many of the practitioner's active appointments each room holds that week. */
async function countByRoom(
  tx: Transaction,
  practitionerId: string,
  roomIds: readonly string[],
  week: TimeRange,
) {
  const rows = await tx
    .select({ roomId: appointment.roomId, total: count() })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, practitionerId),
        inArray(appointment.roomId, [...roomIds]),
        inArray(appointment.status, activeAppointmentStatuses),
        meets(appointment.during, week),
      ),
    )
    .groupBy(appointment.roomId);
  return new Map(rows.map((row) => [row.roomId, row.total]));
}

/** The rooms where the practitioner has a schedule with a day that week. */
async function scheduledRooms(
  tx: Transaction,
  practitionerId: string,
  roomIds: readonly string[],
  week: TimeRange,
) {
  const rows = await tx
    .select({
      roomId: schedule.roomId,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .where(
      and(eq(schedule.practitionerId, practitionerId), inArray(schedule.roomId, [...roomIds])),
    );
  const held = rows.filter(
    (row) => occurrencesDuring({ ...row, timeZone: defaultTimeZone }, week).length > 0,
  );
  return new Set(held.map((row) => row.roomId));
}

/** Who the calendar opens on and where; `undefined` when the actor keeps the default. */
export async function findCalendarOpening(
  tx: Transaction,
  actor: Actor,
  date: string,
  roomIds: readonly string[],
) {
  const practitionerId = await findOwnPractitioner(tx, actor);
  if (practitionerId === undefined) {
    return undefined;
  }
  const firstDate = mondayOf(date);
  const week = toTimeRange(
    { kind: "days", firstDate, lastDate: shiftDate(firstDate, 6) },
    defaultTimeZone,
  );
  const counts = await countByRoom(tx, practitionerId, roomIds, week);
  if (counts.size > 0) {
    const most = Math.max(...counts.values());
    return { practitionerId, roomId: roomIds.find((id) => counts.get(id) === most) };
  }
  const scheduled = await scheduledRooms(tx, practitionerId, roomIds, week);
  return { practitionerId, roomId: roomIds.find((id) => scheduled.has(id)) };
}
