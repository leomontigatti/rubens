import { customType, pgSchema, timestamp } from "drizzle-orm/pg-core";

import type { TimeRange } from "#/lib/time-ranges.ts";

/**
 * Every app table and enum lives in the `rubens` Postgres schema, never in
 * `public`, and carries no name prefix (ADR-0004). Declare tables with
 * `rubens.table(...)` and enums with `rubens.enum(...)`; `pgTable` and `pgEnum`
 * would put them in `public`.
 */
export const rubens = pgSchema("rubens");

/** `created_at` and `updated_at`, for the app's own tables. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

/** One bound of Postgres's text form, `"2026-01-05 03:00:00+00"`, as an instant. */
function parseBound(bound: string): Date {
  const iso = bound
    .replaceAll('"', "")
    .replace(" ", "T")
    .replace(/([+-]\d\d)$/, "$1:00");
  return new Date(iso);
}

/** A half-open span of instants: a `tstzrange` with `[)` bounds. */
export const timeRange = customType<{ data: TimeRange; driverData: string }>({
  dataType: () => "tstzrange",
  toDriver: (range) => `[${range.start.toISOString()},${range.end.toISOString()})`,
  fromDriver: (value) => {
    const [start, end] = value.slice(1, -1).split(",");
    return { start: parseBound(start!), end: parseBound(end!) };
  },
});
