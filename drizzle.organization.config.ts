import { defineConfig } from "drizzle-kit";

// The organization object's schema (ADR-0008), applied by the object itself on
// start (`src/organization/organization.ts`). `pnpm organization:generate`
// writes the SQL and the `migrations.js` index the object imports.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: ["./src/organization/schema.ts", "./src/organization/whatsapp-schema.ts"],
  out: "./src/organization/migrations",
});
