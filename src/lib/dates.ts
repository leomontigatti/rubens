import { TZDate, tz } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// How the app writes a date or a time a person or the assistant reads.

type Instant = Date | number;

const inZone = (timeZone: string) => ({ in: tz(timeZone), locale: es });

export function formatDate(instant: Instant, timeZone: string): string {
  return format(instant, "dd/MM/yyyy", inZone(timeZone));
}

export function formatTime(instant: Instant, timeZone: string): string {
  return format(instant, "HH:mm", inZone(timeZone));
}

export function formatDateTime(instant: Instant, timeZone: string): string {
  return format(instant, "dd/MM/yyyy HH:mm", inZone(timeZone));
}

export function formatDay(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE d 'de' MMMM", inZone(timeZone));
}

/** `domingo 08/11`, inside a sentence that names its time beside it. */
export function formatShortDay(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE dd/MM", inZone(timeZone));
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function formatDayHeading(instant: Instant, timeZone: string): string {
  return capitalized(formatDay(instant, timeZone));
}

export function formatDayHeadingWithYear(instant: Instant, timeZone: string): string {
  return capitalized(format(instant, "EEEE d 'de' MMMM 'de' yyyy", inZone(timeZone)));
}

/** A calendar date, `2026-03-07`, as `07/03/2026`: it falls on no zone. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function formatMonth(month: string): string {
  // Noon UTC of the first, so no zone moves it to another month.
  return format(new Date(`${month}-01T12:00:00Z`), "MMMM 'de' yyyy", inZone("UTC"));
}

/** `Sunday 2026-11-08 23:30`, as the assistant's prompt states the time: in English, the date as ISO. */
export function formatPromptNow(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE yyyy-MM-dd HH:mm", { in: tz(timeZone) });
}

/**
 * `instant` when its hour in the zone is from `hours.opens` up to `hours.closes`,
 * else the next `hours.opens` o'clock there: a message outside the hours waits for
 * the morning.
 */
export function withinHours(
  instant: Instant,
  timeZone: string,
  hours: { opens: number; closes: number },
): number {
  const local = new TZDate(+instant, timeZone);
  const hour = local.getHours();
  if (hour >= hours.opens && hour < hours.closes) {
    return local.getTime();
  }
  if (hour >= hours.closes) {
    local.setDate(local.getDate() + 1);
  }
  local.setHours(hours.opens, 0, 0, 0);
  return local.getTime();
}
