import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  closure,
  member,
  office,
  practitioner,
  room,
  schedule,
  timeOff,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import { parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { availabilityQuerySchema, findFreeStarts } from "#/lib/availability.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { findPractitioner } from "#/server/schedules.ts";
import type { SchedulePractitioner } from "#/server/schedules.ts";

// A practitioner's free times (ui: "Disponibilidad"): the stored schedules,
// time off and closures, handed to the pure module in `#/lib/availability.ts`.
// Reception and admins read anyone's; a practitioner reads their own. The
// dates asked for are read in the organization's default zone. Schedules in a
// deactivated room or office offer nothing. Busy ranges stay empty until
// booking exists. `database` is for tests, which pass a transaction running as
// the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

export interface AvailableStart {
  start: Date;
  officeName: string;
  roomName: string;
  /** The office's zone, to show the start in local time. */
  timeZone: string;
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;

/** Whether the actor may read anyone's free times, before any row is read. */
function readsEveryone(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("receptionist");
}

/** The active practitioners whose free times the actor may read. */
export async function listAvailabilityPractitioners(
  actor: Actor,
  database?: AnyDatabase,
): Promise<SchedulePractitioner[]> {
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select({
          id: practitioner.id,
          displayName: practitioner.displayName,
          userId: member.userId,
          role: member.role,
        })
        .from(practitioner)
        .innerJoin(
          member,
          and(
            eq(member.id, practitioner.memberId),
            eq(member.organizationId, actor.organizationId),
            eq(member.active, true),
          ),
        )
        .orderBy(asc(practitioner.displayName));
      return rows
        .filter((row) => parseRoles(row.role).includes("practitioner"))
        .filter((row) => readsEveryone(actor) || row.userId === actor.userId)
        .map(({ id, displayName }) => ({ id, displayName }));
    },
    database,
  );
}

/** Rows whose `during` meets `range`. */
function meets(during: typeof timeOff.during | typeof closure.during, range: TimeRange): SQL {
  return sql`${during} && tstzrange(${range.start.toISOString()}::timestamptz, ${range.end.toISOString()}::timestamptz, '[)')`;
}

/** The practitioner's free starts from the first to the last date, for the duration. */
export async function getAvailability(
  actor: Actor,
  input: AvailabilityQuery,
  database?: AnyDatabase,
): Promise<
  Result<{
    practitioner: SchedulePractitioner;
    gridMinutes: number;
    freeStarts: AvailableStart[];
  }>
> {
  const parsed = availabilityQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { practitionerId, firstDate, lastDate, durationMinutes } = parsed.data;
  const window = toTimeRange({ kind: "days", firstDate, lastDate }, defaultTimeZone);
  // A start near the window's end runs past it by up to the duration.
  const reach = { start: window.start, end: new Date(+window.end + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, practitionerId, false);
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      if (!readsEveryone(actor) && !found.canEdit) {
        return forbidden;
      }
      // An office in another zone than the default one sees the window a day
      // earlier or later, so the dates are widened by a day each way.
      const schedules = await tx
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
            eq(schedule.practitionerId, found.id),
            lte(schedule.firstDate, shiftDate(lastDate, 1)),
            or(isNull(schedule.lastDate), gte(schedule.lastDate, shiftDate(firstDate, -1))),
          ),
        );
      const timeOffRows = await tx
        .select({ during: timeOff.during })
        .from(timeOff)
        .where(and(eq(timeOff.practitionerId, found.id), meets(timeOff.during, reach)));
      const officeIds = [...new Set(schedules.map((row) => row.officeId))];
      const closureRows = await tx
        .select({ during: closure.during })
        .from(closure)
        .where(
          and(
            officeIds.length > 0
              ? or(isNull(closure.officeId), inArray(closure.officeId, officeIds))
              : isNull(closure.officeId),
            meets(closure.during, reach),
          ),
        );
      const rooms = new Map(schedules.map((row) => [row.roomId, row]));
      const free = findFreeStarts({
        schedules,
        timeOff: timeOffRows.map((row) => row.during),
        closures: closureRows.map((row) => row.during),
        busy: [],
        gridMinutes: found.gridMinutes,
        window,
        durationMinutes,
      });
      return {
        ok: true as const,
        practitioner: { id: found.id, displayName: found.displayName },
        gridMinutes: found.gridMinutes,
        freeStarts: free.map(({ start, roomId }) => {
          const where = rooms.get(roomId)!;
          return {
            start,
            officeName: where.officeName,
            roomName: where.roomName,
            timeZone: where.timeZone,
          };
        }),
      };
    },
    database,
  );
}
