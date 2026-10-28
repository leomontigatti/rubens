import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import * as z from "zod";

import {
  formatLocalDate,
  shiftDate,
  shortTime,
  weekdayLabels,
  weekdayOf,
} from "#/lib/schedules.ts";
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

/** A closure of one office, or of the whole organization when `officeId` is null. */
export interface AvailabilityClosure {
  during: TimeRange;
  officeId: string | null;
}

export interface AvailabilityInput {
  schedules: readonly AvailabilitySchedule[];
  timeOff: readonly TimeRange[];
  /** The closures of the practitioner's offices and of the whole organization. */
  closures: readonly AvailabilityClosure[];
  /** The practitioner's active appointments, overbookings included. */
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

/** An appointment's length in minutes: any whole number, the grid sets none. */
export const durationMinutesSchema = z.int().min(1).max(720);

/** The most days one query covers; the screens ask for a day or a week. */
const maxWindowDays = 31;

/**
 * What the free-times screen asks for: a practitioner, local dates in the
 * organization's default zone (both inclusive) and a duration in minutes.
 */
export const availabilityQuerySchema = z
  .object({
    practitionerId: z.uuid(),
    firstDate: z.iso.date(),
    lastDate: z.iso.date(),
    durationMinutes: durationMinutesSchema,
    /** The appointment being rescheduled: its own time counts as free. */
    appointmentId: z.uuid().optional(),
  })
  .refine((query) => query.firstDate <= query.lastDate, {
    path: ["lastDate"],
    message: "lastBeforeFirst",
  })
  .refine((query) => query.lastDate < shiftDate(query.firstDate, maxWindowDays), {
    path: ["lastDate"],
    message: "windowTooLong",
    // Calendar arithmetic throws on a malformed date, so it waits for the dates to parse.
    when: (payload) => payload.issues.length === 0,
  });

export type AvailabilityQuery = z.input<typeof availabilityQuerySchema>;

const defaultDuration = 30;

/** What the free-times screen's URL asks for, each value already parsed. */
export interface AvailabilitySearch {
  profesional?: string;
  fecha?: string;
  vista?: "dia" | "semana";
  duracion?: number;
}

/** What the screen shows, with its defaults: the only practitioner, today, a day, 30 minutes. */
export function availabilityViewOf(
  search: AvailabilitySearch,
  practitioners: readonly { id: string }[],
  today: string,
) {
  return {
    practitionerId:
      search.profesional ?? (practitioners.length === 1 ? practitioners[0]!.id : undefined),
    firstDate: search.fecha ?? today,
    durationMinutes: search.duracion ?? defaultDuration,
    week: search.vista === "semana",
  };
}

export type AvailabilityView = ReturnType<typeof availabilityViewOf>;

/** The service's query for a view, once a practitioner is chosen. */
export function freeTimesQueryOf(view: AvailabilityView): AvailabilityQuery | null {
  const { practitionerId, firstDate, durationMinutes } = view;
  if (!practitionerId) {
    return null;
  }
  const lastDate = view.week ? shiftDate(firstDate, 6) : firstDate;
  return { practitionerId, firstDate, lastDate, durationMinutes };
}

const minute = 60_000;

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
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

export function appliesOn(schedule: WeeklySlot, date: string): boolean {
  return (
    schedule.weekdays.includes(weekdayOf(date)) &&
    schedule.firstDate <= date &&
    (schedule.lastDate === null || date <= schedule.lastDate)
  );
}

/** The occurrences of `schedule` that meet `span`, as instants in its office's zone. */
export function occurrencesDuring(schedule: AvailabilitySchedule, span: TimeRange): TimeRange[] {
  return datesIn(span, schedule.timeZone)
    .filter((date) => appliesOn(schedule, date))
    .map((date) => ({
      start: instantOf(date, shortTime(schedule.startTime), schedule.timeZone),
      end: instantOf(date, shortTime(schedule.endTime), schedule.timeZone),
    }))
    .filter((occurrence) => intersects(occurrence, span));
}

/** The first schedule one of whose occurrences holds the whole of `span`. */
export function coveringSchedule<T extends AvailabilitySchedule>(
  schedules: readonly T[],
  span: TimeRange,
): T | undefined {
  return schedules.find((schedule) =>
    occurrencesDuring(schedule, span).some(
      (occurrence) => occurrence.start <= span.start && span.end <= occurrence.end,
    ),
  );
}

/** What decides whether a practitioner's span is working time. */
export interface WorkingTime {
  schedules: readonly AvailabilitySchedule[];
  timeOff: readonly TimeRange[];
  /** The closures of the span's office and of the whole organization; others are ignored. */
  closures: readonly AvailabilityClosure[];
}

/** Why a span is outside working time. */
export type OutsideWorkingTime = "timeOff" | "closure" | "outsideSchedules";

/**
 * Why `span`, in the office `officeId`, is outside working time; `null` when
 * it is inside: one occurrence of a schedule in that office holds it whole,
 * and it meets no time off and no closure of the office or the organization.
 */
export function outsideWorkingTime(
  span: TimeRange,
  officeId: string,
  workingTime: WorkingTime,
): OutsideWorkingTime | null {
  if (workingTime.timeOff.some((range) => intersects(range, span))) {
    return "timeOff";
  }
  const closed = workingTime.closures.some(
    (closure) =>
      (closure.officeId === null || closure.officeId === officeId) &&
      intersects(closure.during, span),
  );
  if (closed) {
    return "closure";
  }
  const inOffice = workingTime.schedules.filter((schedule) => schedule.officeId === officeId);
  return coveringSchedule(inOffice, span) ? null : "outsideSchedules";
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
  return input.schedules
    .flatMap((schedule) => {
      const blocked = [
        ...input.timeOff,
        ...input.closures
          .filter(({ officeId }) => officeId === null || officeId === schedule.officeId)
          .map(({ during }) => during),
        ...input.busy,
      ];
      const isFree = (span: TimeRange) =>
        span.start >= window.start &&
        span.start < window.end &&
        !blocked.some((range) => intersects(range, span));
      return datesIn(window, schedule.timeZone)
        .filter((date) => appliesOn(schedule, date))
        .flatMap((date) => gridSpans(schedule, date, input.gridMinutes, input.durationMinutes))
        .filter(isFree)
        .map(({ start }) => ({ start, officeId: schedule.officeId, roomId: schedule.roomId }));
    })
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
