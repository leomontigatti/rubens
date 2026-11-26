import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import * as z from "zod";

import { formatLocalDate, formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { shiftDate, shortTime, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import type { WeeklySlot } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

// A practitioner's free start times, computed from their schedules minus
// everything that blocks them (docs/domain/scheduling.md § Availability). Pure:
// every local time is read in the practice's zone, never the process's.

export interface AvailabilitySchedule extends WeeklySlot {
  officeId: string;
  roomId: string;
}

/** A closure of one office, or of the whole organization when `officeId` is null. */
export interface AvailabilityClosure {
  during: TimeRange;
  officeId: string | null;
}

export interface AvailabilityInput {
  schedules: readonly AvailabilitySchedule[];
  timeOff: readonly TimeRange[];
  closures: readonly AvailabilityClosure[];
  /** The practitioner's active appointments, overbookings included. */
  busy: readonly TimeRange[];
  /** Other practitioners' active appointments in the schedules' rooms, which hold the room. */
  roomBusy: readonly { roomId: string; during: TimeRange }[];
  gridMinutes: number;
  window: TimeRange;
  durationMinutes: number;
}

export interface FreeStart {
  start: Date;
  officeId: string;
  roomId: string;
}

export const durationMinutesSchema = z.int().min(1).max(720);

const maxWindowDays = 31;

function onceTheDatesParse(payload: z.core.ParsePayload): boolean {
  return payload.issues.length === 0;
}

/**
 * What the free-times screen asks for: a practitioner, local dates in the
 * practice's zone (both inclusive) and a duration in minutes.
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
    when: onceTheDatesParse,
  });

export type AvailabilityQuery = z.input<typeof availabilityQuerySchema>;

const defaultDuration = 30;

export interface AvailabilitySearch {
  profesional?: string;
  fecha?: string;
  vista?: "dia" | "semana";
  duracion?: number;
}

export function availabilitySearchProblem(search: AvailabilitySearch): string | null {
  if (!search.profesional) {
    return "Elegí un profesional.";
  }
  if (!search.fecha) {
    return "Ingresá la fecha.";
  }
  if (search.duracion === undefined) {
    return "Ingresá una duración de 1 a 720 minutos.";
  }
  return null;
}

export function availabilityViewOf(
  search: AvailabilitySearch,
  practitioners: readonly { id: string }[],
  today: string,
) {
  return {
    practitionerId:
      search.profesional ?? (practitioners.length === 1 ? practitioners[0]?.id : undefined),
    firstDate: search.fecha ?? today,
    durationMinutes: search.duracion ?? defaultDuration,
    week: search.vista === "semana",
  };
}

export type AvailabilityView = ReturnType<typeof availabilityViewOf>;

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
  const [hours = NaN, minutes = NaN] = shortTime(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

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

export function occurrencesDuring(schedule: WeeklySlot, span: TimeRange): TimeRange[] {
  return datesIn(span, practiceTimeZone)
    .filter((date) => appliesOn(schedule, date))
    .map((date) => ({
      start: instantOf(date, shortTime(schedule.startTime), practiceTimeZone),
      end: instantOf(date, shortTime(schedule.endTime), practiceTimeZone),
    }))
    .filter((occurrence) => intersects(occurrence, span));
}

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

export interface WorkingTime {
  schedules: readonly AvailabilitySchedule[];
  timeOff: readonly TimeRange[];
  closures: readonly AvailabilityClosure[];
}

export type OutsideWorkingTime = "timeOff" | "closure" | "outsideSchedules";

function blockedBy(span: TimeRange, officeId: string, workingTime: WorkingTime) {
  if (workingTime.timeOff.some((range) => intersects(range, span))) {
    return "timeOff";
  }
  const closed = workingTime.closures.some(
    (closure) =>
      (closure.officeId === null || closure.officeId === officeId) &&
      intersects(closure.during, span),
  );
  return closed ? "closure" : null;
}

export function outsideWorkingTime(
  span: TimeRange,
  officeId: string,
  workingTime: WorkingTime,
): OutsideWorkingTime | null {
  const blocked = blockedBy(span, officeId, workingTime);
  if (blocked) {
    return blocked;
  }
  const inOffice = workingTime.schedules.filter((schedule) => schedule.officeId === officeId);
  return coveringSchedule(inOffice, span) ? null : "outsideSchedules";
}

/**
 * `outsideWorkingTime` for many spans that all lie inside `reach`: each
 * schedule's occurrences there are computed once, not again for every span.
 */
export function outsideWorkingTimeWithin(workingTime: WorkingTime, reach: TimeRange) {
  const occurrences = workingTime.schedules.map((schedule) => ({
    officeId: schedule.officeId,
    during: datesIn(reach, practiceTimeZone)
      .filter((date) => appliesOn(schedule, date))
      .map((date) => ({
        start: +instantOf(date, shortTime(schedule.startTime), practiceTimeZone),
        end: +instantOf(date, shortTime(schedule.endTime), practiceTimeZone),
      })),
  }));
  return (span: TimeRange, officeId: string): OutsideWorkingTime | null => {
    const blocked = blockedBy(span, officeId, workingTime);
    if (blocked) {
      return blocked;
    }
    const [start, end] = [+span.start, +span.end];
    const covered = occurrences.some(
      (schedule) =>
        schedule.officeId === officeId &&
        schedule.during.some((occurrence) => occurrence.start <= start && end <= occurrence.end),
    );
    return covered ? null : "outsideSchedules";
  };
}

function gridSpans(
  schedule: AvailabilitySchedule,
  date: string,
  gridMinutes: number,
  durationMinutes: number,
): TimeRange[] {
  const startMinutes = minutesOf(schedule.startTime);
  const endMinutes = minutesOf(schedule.endTime);
  const occurrenceEnd = instantOf(date, timeOf(endMinutes), practiceTimeZone);
  const spans: TimeRange[] = [];
  let point = Math.ceil(startMinutes / gridMinutes) * gridMinutes;
  for (; point < endMinutes; point += gridMinutes) {
    const start = instantOf(date, timeOf(point), practiceTimeZone);
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
 * lies on the grid counted from local midnight in the practice's zone, the
 * whole duration fits inside one occurrence of a schedule, and that span meets
 * no time off, closure or busy range, nor another practitioner's appointment
 * in the schedule's room.
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
        ...input.roomBusy
          .filter(({ roomId }) => roomId === schedule.roomId)
          .map(({ during }) => during),
      ];
      const isFree = (span: TimeRange) =>
        span.start >= window.start &&
        span.start < window.end &&
        !blocked.some((range) => intersects(range, span));
      return datesIn(window, practiceTimeZone)
        .filter((date) => appliesOn(schedule, date))
        .flatMap((date) => gridSpans(schedule, date, input.gridMinutes, input.durationMinutes))
        .filter(isFree)
        .map(({ start }) => ({ start, officeId: schedule.officeId, roomId: schedule.roomId }));
    })
    .sort((a, b) => +a.start - +b.start);
}

interface PlacedStart {
  start: Date;
  officeName: string;
  roomName: string;
}

/**
 * Free starts under the local date each falls on in the practice's zone, dates
 * in order, each start with its local `HH:MM`: "Lunes 05/01/2099", "09:00".
 */
export function freeStartsByDay<T extends PlacedStart>(starts: readonly T[]) {
  const days = new Map<string, (T & { time: string })[]>();
  for (const free of starts) {
    const date = format(free.start, "yyyy-MM-dd", { in: tz(practiceTimeZone) });
    const time = formatTime(free.start, practiceTimeZone);
    const day = days.get(date) ?? [];
    day.push({ ...free, time });
    days.set(date, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) => ({
      date,
      label: `${weekdayLabels[weekdayOf(date)]} ${formatLocalDate(date)}`,
      starts: day,
    }));
}
