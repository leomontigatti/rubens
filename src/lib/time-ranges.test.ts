import { describe, expect, it } from "vite-plus/test";

import type { RangeEntry } from "#/lib/time-ranges.ts";

import { rangeEntryLabel, rangeEntrySchema, toRangeEntry, toTimeRange } from "#/lib/time-ranges.ts";

// Time off and closures are entered as whole days or as hours, local to a zone,
// and stored as instants.

const buenosAires = "America/Argentina/Buenos_Aires";

describe("turning an entry into a time range", () => {
  it("runs whole days from local midnight to the local midnight after the last day", () => {
    expect(
      toTimeRange({ kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-25" }, buenosAires),
    ).toEqual({
      start: new Date("2026-12-24T03:00:00Z"),
      end: new Date("2026-12-26T03:00:00Z"),
    });
  });

  it("reads hours in the zone it is given", () => {
    expect(
      toTimeRange(
        { kind: "hours", start: "2026-11-06T14:00", end: "2026-11-06T20:00" },
        buenosAires,
      ),
    ).toEqual({
      start: new Date("2026-11-06T17:00:00Z"),
      end: new Date("2026-11-06T23:00:00Z"),
    });
  });

  it("follows the zone's daylight-saving change across whole days", () => {
    // Madrid moves from +02:00 to +01:00 on 2026-10-25.
    expect(
      toTimeRange(
        { kind: "days", firstDate: "2026-10-24", lastDate: "2026-10-25" },
        "Europe/Madrid",
      ),
    ).toEqual({
      start: new Date("2026-10-23T22:00:00Z"),
      end: new Date("2026-10-25T23:00:00Z"),
    });
  });
});

describe("reading a time range back as an entry", () => {
  it("gives whole days when both ends fall on local midnight", () => {
    const entry = { kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-25" } as const;
    expect(toRangeEntry(toTimeRange(entry, buenosAires), buenosAires)).toEqual(entry);
  });

  it("gives hours otherwise", () => {
    const entry = { kind: "hours", start: "2026-11-06T14:00", end: "2026-11-07T00:00" } as const;
    expect(toRangeEntry(toTimeRange(entry, buenosAires), buenosAires)).toEqual(entry);
  });
});

describe("validating an entry", () => {
  it("refuses hours whose start is not before their end", () => {
    const parsed = rangeEntrySchema.safeParse({
      kind: "hours",
      start: "2026-11-06T14:00",
      end: "2026-11-06T14:00",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses whole days whose last day is before the first", () => {
    const parsed = rangeEntrySchema.safeParse({
      kind: "days",
      firstDate: "2026-11-06",
      lastDate: "2026-11-05",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a single whole day", () => {
    const parsed = rangeEntrySchema.safeParse({
      kind: "days",
      firstDate: "2026-11-06",
      lastDate: "2026-11-06",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("an entry as the screens show it", () => {
  it.each<[RangeEntry, string]>([
    [{ kind: "days", firstDate: "2026-12-25", lastDate: "2026-12-25" }, "25/12/2026"],
    [
      { kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-31" },
      "Del 24/12/2026 al 31/12/2026",
    ],
    [
      { kind: "hours", start: "2026-11-06T14:00", end: "2026-11-06T18:00" },
      "06/11/2026 de 14:00 a 18:00",
    ],
    [
      { kind: "hours", start: "2026-11-06T14:00", end: "2026-11-07T00:00" },
      "Del 06/11/2026 14:00 al 07/11/2026 00:00",
    ],
  ])("shows %o as %s", (entry, label) => {
    expect(rangeEntryLabel(entry)).toBe(label);
  });
});
