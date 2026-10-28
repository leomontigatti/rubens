import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { appointment, office, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { practitionerWeekQuerySchema } from "#/lib/appointments.ts";
import type { PractitionerWeekQuery } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { booksForSome, selectDayAppointments, toDayAppointment } from "#/server/appointments.ts";
import type { DayColumn } from "#/server/appointments.ts";
import { findFreeTimes, meets } from "#/server/availability.ts";
import { findPractitioner } from "#/server/schedules.ts";

// The week view of one practitioner (docs/domain/appointments.md § Calendar):
// seven local days in the organization's default zone, each with the
// practitioner's schedules, appointments and free starts a grid step long,
// across every office. Reception and admins read anyone's week, a
// practitioner their own. `database` is for tests, which pass a transaction
// running as the app role.

/** One day of the week: a day view's column, under its local date. */
export type WeekDay = Omit<DayColumn, "practitioner" | "gridMinutes"> & { date: string };

/** An office the week touches, with the active rooms a move can pick from. */
export interface WeekOffice {
  id: string;
  name: string;
  timeZone: string;
  rooms: { id: string; name: string }[];
}

const daysInWeek = 7;

function seesEveryone(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("receptionist");
}

function within(instant: Date, range: TimeRange): boolean {
  return range.start <= instant && instant < range.end;
}

export async function getPractitionerWeek(
  actor: Actor,
  input: PractitionerWeekQuery,
  database?: AnyDatabase,
): Promise<
  | {
      ok: true;
      practitioner: { id: string; displayName: string };
      gridMinutes: number;
      days: WeekDay[];
      offices: WeekOffice[];
    }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" }
> {
  if (!booksForSome(actor)) {
    return { ok: false, reason: "forbidden" };
  }
  const parsed = practitionerWeekQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { practitionerId, date, includeCancelled } = parsed.data;
  const dates = Array.from({ length: daysInWeek }, (_, offset) => shiftDate(date, offset));
  const week = toTimeRange(
    { kind: "days", firstDate: date, lastDate: dates.at(-1)! },
    defaultTimeZone,
  );
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, practitionerId, false);
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      if (!seesEveryone(actor) && !found.canEdit) {
        return { ok: false as const, reason: "forbidden" as const };
      }
      const { free, schedules } = await findFreeTimes(tx, found, {
        window: week,
        durationMinutes: found.gridMinutes,
      });
      const bookable = found.active ? free : [];
      const appointmentRows = await selectDayAppointments(tx)
        .where(
          and(
            eq(appointment.practitionerId, found.id),
            includeCancelled ? undefined : ne(appointment.status, "cancelled"),
            meets(appointment.during, week),
          ),
        )
        .orderBy(asc(appointment.during));

      const viewer = { roles: actor.roles, own: found.canEdit };
      const now = new Date();
      const roomNames = new Map(schedules.map((where) => [where.roomId, where.roomName]));
      const days = dates.map((day) => {
        const range = toTimeRange({ kind: "days", firstDate: day, lastDate: day }, defaultTimeZone);
        return {
          date: day,
          schedules: schedules
            .flatMap((where) =>
              occurrencesDuring(where, range)
                .filter((occurrence) => within(occurrence.start, range))
                .map((occurrence) => ({ ...occurrence, roomName: where.roomName })),
            )
            .sort((a, b) => +a.start - +b.start),
          appointments: appointmentRows
            .filter((booked) => within(booked.during.start, range))
            .map((booked) => toDayAppointment(booked, viewer, now)),
          freeStarts: bookable
            .filter((slot) => within(slot.start, range))
            .map((slot) => ({
              start: slot.start,
              roomId: slot.roomId,
              roomName: roomNames.get(slot.roomId)!,
            })),
        };
      });

      const officeIds = [
        ...new Set([
          ...schedules.map((where) => where.officeId),
          ...appointmentRows.map((booked) => booked.officeId),
        ]),
      ];
      const officeRows =
        officeIds.length === 0
          ? []
          : await tx
              .select({ id: office.id, name: office.name, timeZone: office.timeZone })
              .from(office)
              .where(inArray(office.id, officeIds))
              .orderBy(asc(office.name));
      const roomRows =
        officeIds.length === 0
          ? []
          : await tx
              .select({ id: room.id, name: room.name, officeId: room.officeId })
              .from(room)
              .where(and(inArray(room.officeId, officeIds), eq(room.active, true)))
              .orderBy(asc(room.name));
      return {
        ok: true as const,
        practitioner: { id: found.id, displayName: found.displayName },
        gridMinutes: found.gridMinutes,
        days,
        offices: officeRows.map((row) => ({
          ...row,
          rooms: roomRows
            .filter((where) => where.officeId === row.id)
            .map(({ id, name }) => ({ id, name })),
        })),
      };
    },
    database,
  );
}
