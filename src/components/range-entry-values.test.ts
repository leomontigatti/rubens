import { describe, expect, it } from "vite-plus/test";

import { entryFieldNames, entryValues, readRangeEntry } from "#/components/range-entry-values.ts";

describe("a range of hours in the form", () => {
  const hours = {
    kind: "hours",
    start: "2026-11-20T09:00",
    end: "2026-11-21T13:30",
  } as const;

  it("opens as a date and a time for each end, and saves as the entry it opened from", () => {
    const values = entryValues(hours, "practitioner");

    expect(values).toMatchObject({
      startDate: "2026-11-20",
      startTime: "09:00",
      endDate: "2026-11-21",
      endTime: "13:30",
    });
    expect(readRangeEntry(values)).toEqual(hours);
  });

  it("points a refused start at its time when the date is a date, else at its date", () => {
    const values = entryValues(hours, "practitioner");

    expect(entryFieldNames({ ...values, startTime: "25:00" }).start).toBe("startTime");
    expect(entryFieldNames({ ...values, startDate: "31/02/2026" }).start).toBe("startDate");
    expect(entryFieldNames({ ...values, endDate: "" }).end).toBe("endDate");
  });
});

describe("whole days in the form", () => {
  it("open and save as the days, with no hours", () => {
    const days = { kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-26" } as const;

    expect(readRangeEntry(entryValues(days, ""))).toEqual(days);
  });

  it("are what a new entry starts as", () => {
    expect(entryValues(null, "")).toMatchObject({ kind: "days", firstDate: "", lastDate: "" });
  });
});
