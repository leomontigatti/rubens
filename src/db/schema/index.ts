// Better Auth's tables are generated: `npx auth@<better-auth version> generate
// --adapter drizzle --dialect pg --config src/lib/auth.ts --output
// src/db/schema/auth.ts`. The output then needs three edits: every `pgTable(`
// becomes `rubens.table(` (ADR-0004), every `timestamp()` gets
// `withTimezone: true` (instants are `timestamptz`, ADR-0003), and
// `mustChangePassword` gets `.notNull()`. Regenerate after adding an auth plugin
// or a user field.
export * from "./schema.ts";
export * from "./auth.ts";
