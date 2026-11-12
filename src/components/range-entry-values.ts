import { isLocalDate } from "#/components/date-time-text.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

// What a time-off or closure form holds, and the entry it stands for: whole
// days, or a date and a time for each end of a range of hours.

/** What the form holds; `owner` is who or where the entry is for, when the form asks. */
export interface EntryValues {
  owner: string;
  kind: RangeEntry["kind"];
  firstDate: string;
  lastDate: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/** The entry the fields hold, unchecked: the schema decides whether it is one. */
export function readRangeEntry(values: EntryValues): unknown {
  if (values.kind === "hours") {
    return {
      kind: "hours",
      start: `${values.startDate}T${values.startTime}`,
      end: `${values.endDate}T${values.endTime}`,
    };
  }
  return { kind: "days", firstDate: values.firstDate, lastDate: values.lastDate };
}

/**
 * The fields a problem points at: who or where the entry is for is one field,
 * and a start or an end is a date and a time, the date's unless only the time
 * is wrong.
 */
export function entryFieldNames(values: EntryValues) {
  const part = (end: "start" | "end") =>
    isLocalDate(values[`${end}Date`]) ? `${end}Time` : `${end}Date`;
  return { practitionerId: "owner", officeId: "owner", start: part("start"), end: part("end") };
}

/** What the form opens with: the entry's fields, and none for the other kind. */
export function entryValues(initial: RangeEntry | null, owner: string): EntryValues {
  const empty = {
    owner,
    firstDate: "",
    lastDate: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
  };
  if (!initial) {
    return { ...empty, kind: "days" };
  }
  if (initial.kind === "days") {
    return { ...empty, ...initial };
  }
  const [startDate = "", startTime = ""] = initial.start.split("T");
  const [endDate = "", endTime = ""] = initial.end.split("T");
  return { ...empty, kind: "hours", startDate, startTime, endDate, endTime };
}
