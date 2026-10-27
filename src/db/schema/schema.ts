import { pgSchema, timestamp } from "drizzle-orm/pg-core";

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
