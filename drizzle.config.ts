import { defineConfig } from "drizzle-kit";

// Migrations run as the owner role, through the direct connection (ADR-0002).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations/",
  // Only the app schema: `public` holds extensions, `pgboss` the job queue,
  // `drizzle` the migration journal (ADR-0004).
  schemaFilter: ["rubens"],
  dbCredentials: {
    url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
