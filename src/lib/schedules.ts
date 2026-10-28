import { tz, tzOffset } from "@date-fns/tz";
import { format } from "date-fns";
import * as z from "zod";

// A schedule's fields and the rules on them that need no database: the
// validation shared by the form and the services, and the collision check the
// services run on the weekly fields (ADR-0003). Dates are local `YYYY-MM-DD`
// strings and times local `HH:MM` strings, both in the room's office's zone.

/** ISO weekdays, 1 for Monday to 7 for Sunday, with their labels. */
export const weekdayLabels: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const localDate = z.iso.date();
const id = z.uuid();

/** At least one weekday, deduplicated and in week order. */
const weekdays = z
  .array(z.int().min(1).max(7))
  .min(1)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

const fields = {
  roomId: id,
  weekdays,
  startTime: localTime,
  endTime: localTime,
  lastDate: localDate.nullable(),
};

function checkRanges(
  value: { startTime: string; endTime: string; lastDate: string | null },
  firstDate: string,
  context: z.RefinementCtx,
) {
  if (value.startTime >= value.endTime) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endBeforeStart" });
  }
  if (value.lastDate !== null && value.lastDate < firstDate) {
    context.addIssue({ code: "custom", path: ["lastDate"], message: "lastBeforeFirst" });
  }
}

/** A new schedule, shared by the form and the services. */
export const scheduleInputSchema = z
  .object({ practitionerId: id, firstDate: localDate, ...fields })
  .superRefine((value, context) => checkRanges(value, value.firstDate, context));

/** New fields for a schedule, from the date `from` on. */
export const scheduleChangeSchema = z
  .object({ scheduleId: id, from: localDate, ...fields })
  .superRefine((value, context) => checkRanges(value, value.from, context));

export const scheduleEndSchema = z.object({ scheduleId: id, lastDate: localDate });

export const scheduleDeleteSchema = z.object({ scheduleId: id });

export type ScheduleInput = z.input<typeof scheduleInputSchema>;
export type ScheduleChange = z.input<typeof scheduleChangeSchema>;
export type ScheduleEnd = z.input<typeof scheduleEndSchema>;
export type ScheduleDelete = z.input<typeof scheduleDeleteSchema>;

/** Today's date in `timeZone`, whatever the process's zone. */
export function today(timeZone: string, now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd", { in: tz(timeZone) });
}

// Calendar arithmetic on a local date runs on UTC midnights, which have no
// daylight-saving gaps, so the process's zone never shifts a day.
function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** The local date `days` after `date`, counted on the calendar. */
export function shiftDate(date: string, days: number): string {
  const shifted = utcMidnight(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The ISO weekday of a local date. */
export function weekdayOf(date: string): number {
  return utcMidnight(date).getUTCDay() || 7;
}

/** The first date on or after `date` that falls on `weekday`. */
function nextWeekday(date: string, weekday: number): string {
  return shiftDate(date, (weekday - weekdayOf(date) + 7) % 7);
}

/** `HH:MM` or `HH:MM:SS`, as Postgres returns a `time`, cut to `HH:MM`. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

/** The weekly fields the collision check reads. */
export interface WeeklySlot {
  weekdays: readonly number[];
  startTime: string;
  endTime: string;
  firstDate: string;
  lastDate: string | null;
}

function coversDate(slot: WeeklySlot, date: string): boolean {
  return slot.firstDate <= date && (slot.lastDate === null || date <= slot.lastDate);
}

type Dates = Pick<WeeklySlot, "firstDate" | "lastDate">;

/** The dates two schedules both run on, whatever their weekdays; `null` when none. */
export function sharedDates(a: Dates, b: Dates): Dates | null {
  const firstDate = a.firstDate > b.firstDate ? a.firstDate : b.firstDate;
  const lastDate =
    a.lastDate === null || (b.lastDate !== null && b.lastDate < a.lastDate)
      ? b.lastDate
      : a.lastDate;
  return lastDate === null || firstDate <= lastDate ? { firstDate, lastDate } : null;
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Whether two time zones show the same clock every week of `dates`, up to a
 * year past `today` or the first date, so their local times mean the same
 * moments: two names for one clock, as Argentina's provinces are, count as one.
 */
export function sameClock(zoneA: string, zoneB: string, dates: Dates, today: string): boolean {
  if (zoneA === zoneB) {
    return true;
  }
  // Milliseconds, not date strings: a date past year 9999 no longer sorts as one.
  const first = utcMidnight(dates.firstDate).getTime();
  const yearOn = Math.max(first, utcMidnight(today).getTime()) + 371 * dayMs;
  const until =
    dates.lastDate === null ? yearOn : Math.min(utcMidnight(dates.lastDate).getTime(), yearOn);
  const moments = [until];
  for (let moment = first; moment < until; moment += 7 * dayMs) {
    moments.push(moment);
  }
  return moments.every((moment) => {
    const date = new Date(moment);
    return tzOffset(zoneA, date) === tzOffset(zoneB, date);
  });
}

function coversTime(slot: WeeklySlot, time: string): boolean {
  return shortTime(slot.startTime) <= time && time < shortTime(slot.endTime);
}

/**
 * One of `others` that, with `candidate`, puts more than `capacity` schedules
 * at the same moment, and the weekday of that moment; `null` when none does.
 *
 * Ranges are half-open, so schedules that only touch never collide. For each
 * weekday, the schedules are boxes of dates by times, and the busiest moment
 * among them starts at the latest first date and the latest start time of
 * some of them: those corners are the only moments checked, which needs no
 * expansion into dates.
 */
export function findCollision<T extends WeeklySlot>(
  candidate: WeeklySlot,
  others: readonly T[],
  capacity: number,
): { schedule: T; weekday: number } | null {
  for (const weekday of candidate.weekdays) {
    const sameDay = others.filter((other) => other.weekdays.includes(weekday));
    const slots = [candidate, ...sameDay];
    const dates = slots
      .map((slot) =>
        nextWeekday(
          slot.firstDate > candidate.firstDate ? slot.firstDate : candidate.firstDate,
          weekday,
        ),
      )
      .filter((date) => coversDate(candidate, date));
    const times = slots
      .map((slot) => shortTime(slot.startTime))
      .filter((time) => coversTime(candidate, time));
    for (const date of dates) {
      for (const time of times) {
        const present = sameDay.filter(
          (other) => coversDate(other, date) && coversTime(other, time),
        );
        if (present.length + 1 > capacity) {
          return { schedule: present[0]!, weekday };
        }
      }
    }
  }
  return null;
}

/** The weekdays of a schedule as the screens show them: "Lunes, Miércoles". */
export function weekdaysLabel(days: readonly number[]): string {
  return days.map((day) => weekdayLabels[day]).join(", ");
}

/** A local `YYYY-MM-DD` date as `DD/MM/YYYY`. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** The dates a schedule applies, as its screen shows them. */
export function validityLabel(dates: { firstDate: string; lastDate: string | null }): string {
  const from = `Desde el ${formatLocalDate(dates.firstDate)}`;
  return dates.lastDate === null
    ? `${from}, sin fecha de fin`
    : `${from} hasta el ${formatLocalDate(dates.lastDate)}`;
}

/** The schedule a save collides with, told after the refusal. */
export function collisionLabel(collision: {
  practitionerName: string;
  roomName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}): string {
  const day = weekdayLabels[collision.weekday]!.toLowerCase();
  return (
    `Choca con el horario de ${collision.practitionerName} en ${collision.roomName}, ` +
    `los ${day} de ${collision.startTime} a ${collision.endTime}.`
  );
}

/**
 * Where `today` falls in a schedule's dates, and the dates its change and end
 * forms start from: a started schedule changes from today, a future one from
 * its own first date.
 */
export function scheduleState(
  dates: { firstDate: string; lastDate: string | null },
  today: string,
) {
  const started = dates.firstDate <= today;
  return {
    started,
    ended: dates.lastDate !== null && dates.lastDate < today,
    changeFrom: started ? today : dates.firstDate,
    endDefault: dates.lastDate ?? today,
  };
}
