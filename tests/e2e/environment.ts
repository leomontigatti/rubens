import { existsSync } from "node:fs";
import process from "node:process";

import { databaseUrlFor, e2eDatabaseName } from "../../scripts/worktree-db.ts";

// Where the browser suite runs: its own database beside the one `.env` and
// `.env.local` name, and its own port, so a run never touches the dev data or
// the dev server. `playwright.config.ts` and `prepare.ts` both read it. A value
// already in the environment (CI sets them) wins over the files.

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required; is .env present?`);
  }
  return value;
}

function e2eUrl(name: string) {
  const url = required(name);
  return databaseUrlFor(url, e2eDatabaseName(new URL(url).pathname.slice(1)));
}

// Above every dev port (`PORT` is 3000, or 5200 to 5999 in a worktree), so the
// suite's server never takes another worktree's.
const port = Number(process.env.PORT ?? 3000) + 10_000;

export const e2e = {
  port,
  origin: `http://localhost:${port}`,
  /** The app role, as the server connects. */
  databaseUrl: e2eUrl("DATABASE_URL"),
  /** The owner role: migrations and the seed. */
  directDatabaseUrl: e2eUrl("DATABASE_DIRECT_URL"),
  authSecret: required("BETTER_AUTH_SECRET"),
};
