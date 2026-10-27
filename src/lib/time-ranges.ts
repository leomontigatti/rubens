import { TZDate, tz } from "@date-fns/tz";
import { format } from "date-fns";
import * as z from "zod";

import { formatLocalDate, shiftDate } from "#/lib/schedules.ts";

// How time off and closures are entered and stored: an entry is whole local
// days or a local start and end, in an office's zone or the organization's
// default one; the stored time range is the half-open span of instants.

const localDate = z.iso.date();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);

/** Whole days, both inclusive, or a start and an end, `YYYY-MM-DDTHH:MM`. */
export const rangeEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("days"), firstDate: localDate, lastDate: localDate })
    .refine((entry) => entry.firstDate <= entry.lastDate, {
      path: ["lastDate"],
      message: "lastBeforeFirst",
    }),
  z
    .object({ kind: z.literal("hours"), start: localDateTime, end: localDateTime })
    .refine((entry) => entry.start < entry.end, { path: ["end"], message: "endBeforeStart" }),
]);

export type RangeEntry = z.infer<typeof rangeEntrySchema>;

export interface TimeRange {
  start: Date;
  end: Date;
}

/** The instant a local `YYYY-MM-DD` date at `HH:MM` falls on in `timeZone`. */
export function instantOf(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(+new TZDate(year!, month! - 1, day!, hours!, minutes!, timeZone));
}

/** An entry as instants: whole days run from local midnight to the midnight after the last. */
export function toTimeRange(entry: RangeEntry, timeZone: string): TimeRange {
  if (entry.kind === "days") {
    return {
      start: instantOf(entry.firstDate, "00:00", timeZone),
      end: instantOf(shiftDate(entry.lastDate, 1), "00:00", timeZone),
    };
  }
  const [startDate, startTime] = entry.start.split("T");
  const [endDate, endTime] = entry.end.split("T");
  return {
    start: instantOf(startDate!, startTime!, timeZone),
    end: instantOf(endDate!, endTime!, timeZone),
  };
}

/** A time range as the entry that gives it: whole days when both ends are local midnights. */
export function toRangeEntry(range: TimeRange, timeZone: string): RangeEntry {
  const local = (instant: Date) => format(instant, "yyyy-MM-dd'T'HH:mm", { in: tz(timeZone) });
  const start = local(range.start);
  const end = local(range.end);
  if (start.endsWith("T00:00") && end.endsWith("T00:00")) {
    return {
      kind: "days",
      firstDate: start.slice(0, 10),
      lastDate: shiftDate(end.slice(0, 10), -1),
    };
  }
  return { kind: "hours", start, end };
}

/** An entry as the screens show it: "25/12/2026", "06/11/2026 de 14:00 a 18:00". */
export function rangeEntryLabel(entry: RangeEntry): string {
  if (entry.kind === "days") {
    const first = formatLocalDate(entry.firstDate);
    return entry.firstDate === entry.lastDate
      ? first
      : `Del ${first} al ${formatLocalDate(entry.lastDate)}`;
  }
  const [startDate, startTime] = entry.start.split("T");
  const [endDate, endTime] = entry.end.split("T");
  if (startDate === endDate) {
    return `${formatLocalDate(startDate!)} de ${startTime} a ${endTime}`;
  }
  return `Del ${formatLocalDate(startDate!)} ${startTime} al ${formatLocalDate(endDate!)} ${endTime}`;
}

const id = z.uuid();

/** Time off for a practitioner, shared by the form and the services. */
export const timeOffInputSchema = z.object({ practitionerId: id, entry: rangeEntrySchema });

export const timeOffUpdateSchema = z.object({ timeOffId: id, entry: rangeEntrySchema });

export const timeOffDeleteSchema = z.object({ timeOffId: id });

/** A closure of one office, or of the whole organization when `officeId` is null. */
export const closureInputSchema = z.object({ officeId: id.nullable(), entry: rangeEntrySchema });

export const closureUpdateSchema = closureInputSchema.extend({ closureId: id });

export const closureDeleteSchema = z.object({ closureId: id });

/**
 * The offices a closure's form offers: the active ones, plus the closure's own
 * office when it has since been deactivated, so editing keeps it.
 */
export function closureOfficeOptions<T extends { id: string; name: string }>(
  activeOffices: readonly T[],
  editing: { officeId: string | null; officeName: string | null },
): { id: string; name: string }[] {
  const options: { id: string; name: string }[] = [...activeOffices];
  if (
    editing.officeId !== null &&
    editing.officeName !== null &&
    !options.some((office) => office.id === editing.officeId)
  ) {
    options.push({ id: editing.officeId, name: editing.officeName });
  }
  return options;
}

export type TimeOffInput = z.input<typeof timeOffInputSchema>;
export type TimeOffUpdate = z.input<typeof timeOffUpdateSchema>;
export type TimeOffDelete = z.input<typeof timeOffDeleteSchema>;
export type ClosureInput = z.input<typeof closureInputSchema>;
export type ClosureUpdate = z.input<typeof closureUpdateSchema>;
export type ClosureDelete = z.input<typeof closureDeleteSchema>;
