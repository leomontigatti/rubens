import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import * as z from "zod";

import { formatLocalDate, shiftDate, shortTime, weekdayLabels } from "#/lib/schedules.ts";
import type { WeeklySlot } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

// A practitioner's free start times, computed from their schedules minus
// everything that blocks them (docs/domain/scheduling.md § Availability). Pure:
// every local time is read in its office's zone, never the process's.

/** A schedule with where it is: its office's zone, office and room. */
export interface AvailabilitySchedule extends WeeklySlot {
  officeId: string;
  roomId: string;
  timeZone: string;
}

export interface AvailabilityInput {
  schedules: readonly AvailabilitySchedule[];
  timeOff: readonly TimeRange[];
  /** The closures of the practitioner's offices and of the whole organization. */
  closures: readonly TimeRange[];
  /** Booked appointments; none until booking exists. */
  busy: readonly TimeRange[];
  gridMinutes: number;
  window: TimeRange;
  durationMinutes: number;
}

export interface FreeStart {
  start: Date;
  officeId: string;
  roomId: string;
}

/**
 * What the free-times screen asks for: a practitioner, local dates in the
 * organization's default zone (both inclusive) and a duration in minutes.
 */
export const availabilityQuerySchema = z
  .object({
    practitionerId: z.uuid(),
    firstDate: z.iso.date(),
    lastDate: z.iso.date(),
    durationMinutes: z.int().min(5).max(720),
  })
  .refine((query) => query.firstDate <= query.lastDate, {
    path: ["lastDate"],
    message: "lastBeforeFirst",
  });

export type AvailabilityQuery = z.input<typeof availabilityQuerySchema>;

const minute = 60_000;

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

function minutesOf(time: string): number {
  const [hours, minutes] = shortTime(time).split(":").map(Number);
  return hours! * 60 + minutes!;
}

function timeOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The local dates in `timeZone` that the window touches. */
function datesIn(window: TimeRange, timeZone: string): string[] {
  const last = localDate(window.end, timeZone);
  const dates: string[] = [];
  for (let date = localDate(window.start, timeZone); date <= last; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function appliesOn(schedule: WeeklySlot, date: string): boolean {
  return (
    schedule.weekdays.includes(weekdayOf(date)) &&
    schedule.firstDate <= date &&
    (schedule.lastDate === null || date <= schedule.lastDate)
  );
}

/**
 * The spans of `durationMinutes` that start on the grid inside one occurrence
 * of `schedule`, on `date`, and end by its end.
 */
function gridSpans(
  schedule: AvailabilitySchedule,
  date: string,
  gridMinutes: number,
  durationMinutes: number,
): TimeRange[] {
  const startMinutes = minutesOf(schedule.startTime);
  const endMinutes = minutesOf(schedule.endTime);
  const occurrenceEnd = instantOf(date, timeOf(endMinutes), schedule.timeZone);
  const spans: TimeRange[] = [];
  let point = Math.ceil(startMinutes / gridMinutes) * gridMinutes;
  for (; point < endMinutes; point += gridMinutes) {
    const start = instantOf(date, timeOf(point), schedule.timeZone);
    const end = new Date(+start + durationMinutes * minute);
    if (end > occurrenceEnd) {
      break;
    }
    spans.push({ start, end });
  }
  return spans;
}

/**
 * The free starts inside the window, in time order. A start is free when it
 * lies on the grid counted from local midnight in its office's zone, the
 * whole duration fits inside one occurrence of a schedule, and that span meets
 * no time off, closure or busy range.
 */
export function findFreeStarts(input: AvailabilityInput): FreeStart[] {
  const { window } = input;
  const blocked = [...input.timeOff, ...input.closures, ...input.busy];
  const isFree = (span: TimeRange) =>
    span.start >= window.start &&
    span.start < window.end &&
    !blocked.some((range) => intersects(range, span));
  return input.schedules
    .flatMap((schedule) =>
      datesIn(window, schedule.timeZone)
        .filter((date) => appliesOn(schedule, date))
        .flatMap((date) => gridSpans(schedule, date, input.gridMinutes, input.durationMinutes))
        .filter(isFree)
        .map(({ start }) => ({ start, officeId: schedule.officeId, roomId: schedule.roomId })),
    )
    .sort((a, b) => +a.start - +b.start);
}

/** A free start as the screen receives it: where, and in which zone to show it. */
interface PlacedStart {
  start: Date;
  timeZone: string;
  officeName: string;
  roomName: string;
}

/**
 * Free starts under the local date each falls on in its office's zone, dates
 * in order, each start with its local `HH:MM`: "Lunes 05/01/2099", "09:00".
 */
export function freeStartsByDay<T extends PlacedStart>(starts: readonly T[]) {
  const days = new Map<string, (T & { time: string })[]>();
  for (const free of starts) {
    const local = format(free.start, "yyyy-MM-dd HH:mm", { in: tz(free.timeZone) });
    const [date, time] = local.split(" ");
    const day = days.get(date!) ?? [];
    day.push({ ...free, time: time! });
    days.set(date!, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) => ({
      date,
      label: `${weekdayLabels[weekdayOf(date)]} ${formatLocalDate(date)}`,
      starts: day,
    }));
}
