// Better Auth's tables are generated: `npx auth@<better-auth version> generate
// --adapter drizzle --dialect pg --config src/lib/auth.ts --output
// src/db/schema/auth.ts`. The output then needs two edits: every `pgTable(`
// becomes `rubens.table(` (ADR-0004), and every `timestamp()` gets
// `withTimezone: true` (instants are `timestamptz`, ADR-0003). Regenerate after
// adding an auth plugin.
export * from "./schema.ts";
export * from "./auth.ts";
