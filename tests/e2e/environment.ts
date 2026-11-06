import { existsSync } from "node:fs";
import process from "node:process";

// Where the browser suite runs: its own port and its own object storage, so a
// run never touches the dev data or the dev server. `playwright.config.ts` and
// `prepare.ts` both read it. A value already in the environment (CI sets
// `PORT`) wins over the files.

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

// Above every dev port (`PORT` is 3000, or 5200 to 5999 in a worktree), so the
// suite's server never takes another worktree's.
const port = Number(process.env.PORT ?? 3000) + 10_000;

export const e2e = {
  port,
  origin: `http://localhost:${port}`,
  /** Where the served build keeps its Durable Objects' storage, wiped by `prepare.ts`. */
  stateDirectory: ".wrangler/e2e-state",
};
