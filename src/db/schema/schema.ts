import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Every app table and enum lives in the `rubens` Postgres schema, never in
 * `public`, and carries no name prefix (ADR-0004). Declare tables with
 * `rubens.table(...)` and enums with `rubens.enum(...)`; `pgTable` and `pgEnum`
 * would put them in `public`.
 */
export const rubens = pgSchema("rubens");
