import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  findMutatedMigrationFiles,
  findRewrittenJournalEntries,
  parseJournalEntries,
} from "./migrations/journal.mjs";
import { migrationsPath, readMigrationChanges } from "./migrations/migration-changes.mjs";

/**
 * Fails a branch that edits, deletes or renames a migration already on the base
 * branch, or that rewrites a journal entry already there. Why an applied
 * migration is frozen, and why a comment counts, is explained once in
 * scripts/migrations/journal.mjs.
 *
 * Runs in CI and locally, so the GitHub Actions annotation prefix is only
 * emitted under Actions, where it means something.
 *
 * Usage: node scripts/check-migration-immutability.mjs [base-ref]
 */

const journalPath = `${migrationsPath}/meta/_journal.json`;
const baseRef = process.argv[2] ?? "origin/main";
const errorPrefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";

/**
 * @returns {import("./migrations/journal.mjs").JournalEntry[] | undefined}
 */
function readBaseJournalEntries() {
  const result = spawnSync("git", ["show", `${baseRef}:${journalPath}`], {
    encoding: "utf8",
  });

  return result.status === 0 ? parseJournalEntries(result.stdout) : undefined;
}

const changes = readMigrationChanges(baseRef);
const baseEntries = readBaseJournalEntries();

if (changes === undefined || baseEntries === undefined) {
  console.log(`No migrations on ${baseRef}; nothing to compare against.`);
  process.exit(0);
}

const mutatedFiles = findMutatedMigrationFiles({ changes });
const rewrittenEntries = findRewrittenJournalEntries({
  baseEntries,
  headEntries: parseJournalEntries(
    readFileSync(fileURLToPath(new URL(`../${journalPath}`, import.meta.url)), "utf8"),
  ),
});

/** @type {Record<import("./migrations/journal.mjs").MigrationFileProblem["reason"], string>} */
const verbOf = {
  modified: "was edited",
  removed: "was deleted",
  renamed: "was renamed",
};

for (const problem of mutatedFiles) {
  console.error(
    `${errorPrefix}${problem.path} ${verbOf[problem.reason]}, but it is already on ${baseRef}. ` +
      `Drizzle hashes the whole .sql file and compares it against drizzle.__drizzle_migrations, ` +
      `so any change — a comment included — makes the container refuse to start. ` +
      `Restore the file and correct it with a new migration instead.`,
  );
}

for (const problem of rewrittenEntries) {
  const verb = problem.reason === "entry-removed" ? `was removed from` : `was rewritten in`;

  console.error(
    `${errorPrefix}${problem.tag} (when=${problem.when}) ${verb} the journal, but it is already on ${baseRef}. ` +
      `Its timestamp is what pairs it with a row in drizzle.__drizzle_migrations; only new entries may be appended.`,
  );
}

if (mutatedFiles.length > 0 || rewrittenEntries.length > 0) {
  process.exit(1);
}

console.log(`Applied migrations are unchanged since ${baseRef}.`);
