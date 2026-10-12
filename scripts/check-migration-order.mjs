import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findOutOfOrderEntries, parseJournalEntries } from "./migrations/journal.mjs";

/**
 * Fails a branch whose new migrations carry timestamps at or below the newest
 * migration already on the base branch. Why that is fatal, and why `db-gate`
 * cannot catch it, is explained once in scripts/migrations/journal.mjs.
 *
 * Runs in CI and locally, so the GitHub Actions annotation prefix is only
 * emitted under Actions, where it means something.
 *
 * Usage: node scripts/check-migration-order.mjs [base-ref]
 */

const journalPath = "src/db/migrations/meta/_journal.json";
const baseRef = process.argv[2] ?? "origin/main";
const errorPrefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";

/**
 * `undefined` when the base ref or its journal cannot be read, which is the
 * normal state of a repo with no remote yet.
 */
function readBaseEntries() {
  const result = spawnSync("git", ["show", `${baseRef}:${journalPath}`], {
    encoding: "utf8",
  });

  return result.status === 0 ? parseJournalEntries(result.stdout) : undefined;
}

const baseEntries = readBaseEntries();

if (baseEntries === undefined) {
  console.log(`No migration journal on ${baseRef}; nothing to compare against.`);
  process.exit(0);
}

const headEntries = parseJournalEntries(
  readFileSync(fileURLToPath(new URL(`../${journalPath}`, import.meta.url)), "utf8"),
);
const outOfOrderEntries = findOutOfOrderEntries({ baseEntries, headEntries });

if (outOfOrderEntries.length > 0) {
  for (const entry of outOfOrderEntries) {
    console.error(
      `${errorPrefix}${entry.tag} (when=${entry.when}) is not newer than every migration already on ${baseRef}. ` +
        `Drizzle applies migrations by high-water mark, so this one would never run in production. ` +
        `Rebase on ${baseRef} and regenerate it with pnpm db:generate.`,
    );
  }

  process.exit(1);
}

console.log(`Migration order is consistent with ${baseRef}.`);
