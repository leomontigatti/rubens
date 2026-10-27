// Better Auth's tables are generated: `npx auth@<better-auth version> generate
// --adapter drizzle --dialect pg --config src/lib/auth.ts --output
// src/db/schema/auth.ts`. The output then needs three edits: every `pgTable(`
// becomes `rubens.table(` (ADR-0004), every `timestamp()` gets
// `withTimezone: true` (instants are `timestamptz`, ADR-0003),
// `mustChangePassword` and the member's `active` get `.notNull()`, and `member`
// gets the `(id, organization_id)` unique constraint `practitioner`'s
// composite key targets. Regenerate after adding an auth plugin or a field.
export * from "#/db/schema/schema.ts";
export * from "#/db/schema/auth.ts";
export * from "#/db/schema/offices.ts";
export * from "#/db/schema/staff.ts";
