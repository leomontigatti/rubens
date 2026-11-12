import { formatLocalDate } from "#/lib/dates.ts";

// What a date or a time field holds for what is typed in it. The form holds
// `YYYY-MM-DD` and `HH:MM`, as the schemas read them; the box shows
// `dd/mm/aaaa` and `HH:mm`, whatever the browser's language. Text that names
// no date or time is held as typed, so the form's schema refuses it instead
// of saving the field empty.

/** How one kind of field reads and writes its text. */
export interface TypedText {
  /** The text as the box keeps it: digits and separators, its separators put in for digits alone. */
  mask: (text: string) => string;
  /** The value the text names, or `null` when it names none. */
  parse: (text: string) => string | null;
  /** The value as the box writes it. */
  show: (value: string) => string;
}

/**
 * Digits in segments of `lengths`: a typed separator ends a segment early,
 * and a digit past a full segment starts the next one. Anything else is
 * dropped, and so is what goes past the last segment.
 */
function maskSegments(text: string, separator: string, lengths: readonly number[]): string {
  const segments = [""];
  for (const char of text) {
    const last = segments.length - 1;
    const room = segments.length < lengths.length;
    if (char === separator) {
      if (segments[last] !== "" && room) {
        segments.push("");
      }
    } else if (/\d/.test(char)) {
      if (segments[last]!.length < lengths[last]!) {
        segments[last] += char;
      } else if (room) {
        segments.push(char);
      }
    }
  }
  return segments.join(separator);
}

/** Whether `value` is a calendar date, `YYYY-MM-DD`, rather than text that names none. */
export const isLocalDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export const dateText: TypedText = {
  mask: (text) => maskSegments(text, "/", [2, 2, 4]),
  parse(text) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) {
      return null;
    }
    const [day, month, year] = match.slice(1).map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    const exists = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    return exists ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : null;
  },
  show: (value) => (isLocalDate(value) ? formatLocalDate(value) : value),
};

export const timeText: TypedText = {
  mask: (text) => maskSegments(text, ":", [2, 2]),
  parse(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) {
      return null;
    }
    const [hours, minutes] = match.slice(1).map(Number) as [number, number];
    return hours <= 23 && minutes <= 59 ? `${pad(hours)}:${pad(minutes)}` : null;
  },
  show: (value) => value,
};

/** What the form holds for `text`: the value it names, nothing, or the text itself. */
export function typedValue(kind: TypedText, text: string): string {
  return kind.parse(text) ?? text;
}

/** What the box shows: the text being typed while it stands for `value`, else `value` written. */
export function shownText(kind: TypedText, draft: string | null, value: string): string {
  if (draft !== null && typedValue(kind, draft) === value) {
    return draft;
  }
  return kind.show(value);
}
