import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  appointment,
  closure,
  member,
  office,
  practitioner,
  room,
  schedule,
  timeOff,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { actsForEveryone, parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { availabilityQuerySchema, findFreeStarts } from "#/lib/availability.ts";
import type {
  AvailabilityClosure,
  AvailabilityQuery,
  AvailabilitySchedule,
  FreeStart,
} from "#/lib/availability.ts";
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
// deactivated room or office offer nothing. The practitioner's active
// appointments are busy. `database` is for tests, which pass a transaction running as
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
        .filter((row) => actsForEveryone(actor) || row.userId === actor.userId)
        .map(({ id, displayName }) => ({ id, displayName }));
    },
    database,
  );
}

/** Rows whose `during` meets `range`. */
export function meets(
  during: typeof timeOff.during | typeof closure.during | typeof appointment.during,
  range: TimeRange,
): SQL {
  return sql`${during} && tstzrange(${range.start.toISOString()}::timestamptz, ${range.end.toISOString()}::timestamptz, '[)')`;
}

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
}

/**
 * The practitioner's time off that meets `range`, and the closures that meet
 * it of the organization and of the offices `officeIds`.
 */
export async function findBlocking(
  tx: Transaction,
  practitionerId: string,
  range: TimeRange,
  officeIds: readonly string[],
): Promise<{ timeOff: TimeRange[]; closures: AvailabilityClosure[] }> {
  const timeOffRows = await tx
    .select({ during: timeOff.during })
    .from(timeOff)
    .where(and(eq(timeOff.practitionerId, practitionerId), meets(timeOff.during, range)));
  const closures = await tx
    .select({ during: closure.during, officeId: closure.officeId })
    .from(closure)
    .where(
      and(
        officeIds.length > 0
          ? or(isNull(closure.officeId), inArray(closure.officeId, [...officeIds]))
          : isNull(closure.officeId),
        meets(closure.during, range),
      ),
    );
  return { timeOff: timeOffRows.map((row) => row.during), closures };
}

/** A schedule as the free times read it, with its office's and room's names. */
export type FreeTimeSchedule = AvailabilitySchedule & { officeName: string; roomName: string };

/**
 * The practitioner's free starts of `durationMinutes` inside `window`, and the
 * schedules they come from. With `officeId`, only that office's schedules
 * count. Busy ranges are the practitioner's active appointments, overbookings
 * included, but for `excludeAppointmentId`, the one being rescheduled.
 */
export async function findFreeTimes(
  tx: Transaction,
  practitioner: { id: string; gridMinutes: number },
  options: {
    window: TimeRange;
    durationMinutes: number;
    officeId?: string;
    excludeAppointmentId?: string;
  },
): Promise<{ free: FreeStart[]; schedules: FreeTimeSchedule[] }> {
  const { window, durationMinutes, officeId, excludeAppointmentId } = options;
  // A start near the window's end runs past it by up to the duration.
  const reach = { start: window.start, end: new Date(+window.end + durationMinutes * 60_000) };
  // An office in another zone than the default one sees the window a day
  // earlier or later, so the dates are widened by a day each way.
  const firstDate = shiftDate(localDate(window.start, defaultTimeZone), -1);
  const lastDate = shiftDate(localDate(reach.end, defaultTimeZone), 1);
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
        eq(schedule.practitionerId, practitioner.id),
        officeId === undefined ? undefined : eq(office.id, officeId),
        lte(schedule.firstDate, lastDate),
        or(isNull(schedule.lastDate), gte(schedule.lastDate, firstDate)),
      ),
    );
  const blocking = await findBlocking(tx, practitioner.id, reach, [
    ...new Set(schedules.map((row) => row.officeId)),
  ]);
  const busyRows = await tx
    .select({ during: appointment.during })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, practitioner.id),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment.during, reach),
        excludeAppointmentId === undefined ? undefined : ne(appointment.id, excludeAppointmentId),
      ),
    );
  const rooms = [...new Set(schedules.map((row) => row.roomId))];
  const roomBusy =
    rooms.length === 0
      ? []
      : await tx
          .select({ roomId: appointment.roomId, during: appointment.during })
          .from(appointment)
          .where(
            and(
              inArray(appointment.roomId, rooms),
              ne(appointment.practitionerId, practitioner.id),
              inArray(appointment.status, [...activeAppointmentStatuses]),
              meets(appointment.during, reach),
            ),
          );
  const free = findFreeStarts({
    schedules,
    ...blocking,
    busy: busyRows.map((row) => row.during),
    roomBusy,
    gridMinutes: practitioner.gridMinutes,
    window,
    durationMinutes,
  });
  return { free, schedules };
}

/** Free starts as the screens receive them, with their office's and room's names. */
export function toAvailableStarts(
  free: readonly FreeStart[],
  schedules: readonly FreeTimeSchedule[],
): AvailableStart[] {
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
  const { practitionerId, firstDate, lastDate, durationMinutes, appointmentId } = parsed.data;
  const window = toTimeRange({ kind: "days", firstDate, lastDate }, defaultTimeZone);
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, practitionerId, false);
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      if (!actsForEveryone(actor) && !found.canEdit) {
        return forbidden;
      }
      const { free, schedules } = await findFreeTimes(tx, found, {
        window,
        durationMinutes,
        excludeAppointmentId: appointmentId,
      });
      return {
        ok: true as const,
        practitioner: { id: found.id, displayName: found.displayName },
        gridMinutes: found.gridMinutes,
        freeStarts: toAvailableStarts(free, schedules),
      };
    },
    database,
  );
}
