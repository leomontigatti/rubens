import { and, count, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import { appointment, member, practitioner, schedule } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { activeAppointmentStatuses, mondayOf } from "#/lib/appointments.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";

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
  days: { firstDate: string; lastDate: string },
) {
  const rows = await tx
    .select({ roomId: appointment.roomId, total: count() })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, practitionerId),
        inArray(appointment.roomId, [...roomIds]),
        inArray(appointment.status, activeAppointmentStatuses),
        meets(appointment.during, toTimeRange({ kind: "days", ...days }, defaultTimeZone)),
      ),
    )
    .groupBy(appointment.roomId);
  return new Map(rows.map((row) => [row.roomId, row.total]));
}

/** The rooms where the practitioner has a schedule that meets the week. */
async function scheduledRooms(
  tx: Transaction,
  practitionerId: string,
  roomIds: readonly string[],
  days: { firstDate: string; lastDate: string },
) {
  const rows = await tx
    .selectDistinct({ roomId: schedule.roomId })
    .from(schedule)
    .where(
      and(
        eq(schedule.practitionerId, practitionerId),
        inArray(schedule.roomId, [...roomIds]),
        lte(schedule.firstDate, days.lastDate),
        or(isNull(schedule.lastDate), gte(schedule.lastDate, days.firstDate)),
      ),
    );
  return new Set(rows.map((row) => row.roomId));
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
  const days = { firstDate, lastDate: shiftDate(firstDate, 6) };
  const counts = await countByRoom(tx, practitionerId, roomIds, days);
  if (counts.size > 0) {
    const most = Math.max(...counts.values());
    return { practitionerId, roomId: roomIds.find((id) => counts.get(id) === most) };
  }
  const scheduled = await scheduledRooms(tx, practitionerId, roomIds, days);
  return { practitionerId, roomId: roomIds.find((id) => scheduled.has(id)) };
}
