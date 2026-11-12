import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// How the app writes a date or a time a user reads: day first, a 24-hour
// clock, Spanish names. An instant is written in the zone passed, never the
// process's or the browser's, so the caller decides which zone a screen
// shows. Formats a person, or the assistant, reads are written here only; the
// `ui/no-raw-date-format` lint rule keeps them out of the other files.

type Instant = Date | number;

const inZone = (timeZone: string) => ({ in: tz(timeZone), locale: es });

/** `08/11/2026`. */
export function formatDate(instant: Instant, timeZone: string): string {
  return format(instant, "dd/MM/yyyy", inZone(timeZone));
}

/** `09:05`, on a 24-hour clock. */
export function formatTime(instant: Instant, timeZone: string): string {
  return format(instant, "HH:mm", inZone(timeZone));
}

/** `08/11/2026 09:05`. */
export function formatDateTime(instant: Instant, timeZone: string): string {
  return format(instant, "dd/MM/yyyy HH:mm", inZone(timeZone));
}

/** `domingo 8 de noviembre`, inside a sentence. */
export function formatDay(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE d 'de' MMMM", inZone(timeZone));
}

/** `domingo 08/11`, inside a sentence that names its time beside it. */
export function formatShortDay(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE dd/MM", inZone(timeZone));
}

/** `Domingo 8 de noviembre`, over the day's entries. */
export function formatDayHeading(instant: Instant, timeZone: string): string {
  const day = formatDay(instant, timeZone);
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** A calendar date, `2026-03-07`, as `07/03/2026`: it falls on no zone. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** A calendar month, `2098-12`, as `diciembre de 2098`. */
export function formatMonth(month: string): string {
  // Noon UTC of the first, so no zone moves it to another month.
  return format(new Date(`${month}-01T12:00:00Z`), "MMMM 'de' yyyy", inZone("UTC"));
}

/** `Sunday 2026-11-08 23:30`, as the assistant's prompt states the time: in English, the date as ISO. */
export function formatPromptNow(instant: Instant, timeZone: string): string {
  return format(instant, "EEEE yyyy-MM-dd HH:mm", { in: tz(timeZone) });
}
