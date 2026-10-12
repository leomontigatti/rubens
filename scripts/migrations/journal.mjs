import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Pure reasoning about the Drizzle migration journal, shared by the container
 * entrypoint (scripts/migrate.mjs) and the CI ordering check
 * (scripts/check-migration-order.mjs).
 *
 * This module is the single home for the reasoning; the entrypoint, the CI
 * check and the workflow step point here instead of restating it.
 *
 * `drizzle-orm` tracks applied migrations with a high-water mark rather than
 * set membership: `pg-core/dialect.js` reads `order by created_at desc limit 1`
 * and then applies every migration whose `when` is *strictly greater*. Three
 * consequences, and every check below follows from one of them:
 *
 * 1. A migration merged with a timestamp at or below the watermark is skipped
 *    permanently, and silently. `findOutOfOrderEntries` catches that in review,
 *    `findJournalInconsistencies` at container start.
 * 2. The stored `hash` is written but never read back, so a `.sql` file edited
 *    after being applied goes unnoticed. `findJournalInconsistencies` reads it
 *    at container start; `findMutatedMigrationFiles` and
 *    `findRewrittenJournalEntries` refuse the edit in review, before a deploy
 *    can fail its healthcheck over it.
 * 3. The watermark is read *outside* the transaction that then applies the
 *    migrations, so overlapping starts act on the same stale read — which is
 *    why `scripts/migrate.mjs` holds an advisory lock across both.
 *
 * @typedef {{ idx: number; tag: string; when: number }} JournalEntry
 * @typedef {JournalEntry & { hash: string }} HashedJournalEntry
 * @typedef {{ hash: string; createdAt: number }} AppliedMigration
 * @typedef {"not-applied" | "hash-mismatch" | "out-of-order" | "entry-removed" | "entry-rewritten"} JournalProblemReason
 * @typedef {{ tag: string; when: number; reason: JournalProblemReason }} JournalProblem
 * @typedef {"modified" | "removed" | "renamed" | "added"} MigrationFileChangeStatus
 * @typedef {{ path: string; status: MigrationFileChangeStatus }} MigrationFileChange
 * @typedef {{ path: string; reason: Exclude<MigrationFileChangeStatus, "added"> }} MigrationFileProblem
 */

/**
 * The mark Drizzle compares against: the newest timestamp in a set of
 * migrations. `undefined` for an empty set, which every caller reads as
 * "nothing to compare against yet".
 *
 * @param {number[]} timestamps
 * @returns {number | undefined}
 */
function watermarkOf(timestamps) {
  return timestamps.length === 0 ? undefined : Math.max(...timestamps);
}

/**
 * @param {string} journalContents
 * @returns {JournalEntry[]}
 */
export function parseJournalEntries(journalContents) {
  const journal = /** @type {{ entries?: JournalEntry[] }} */ (JSON.parse(journalContents));

  return journal.entries ?? [];
}

/**
 * Hashes each entry the way `drizzle-orm`'s `readMigrationFiles` does: sha256
 * over the raw `.sql` contents. The hash and `when` pair is the identity a
 * migration carries into `drizzle.__drizzle_migrations`.
 *
 * @param {string} migrationsFolder
 * @returns {HashedJournalEntry[]}
 */
export function readHashedJournalEntries(migrationsFolder) {
  const entries = parseJournalEntries(
    readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"),
  );

  return entries.map((entry) => {
    const migrationSql = readFileSync(`${migrationsFolder}/${entry.tag}.sql`, "utf8");

    return {
      ...entry,
      hash: createHash("sha256").update(migrationSql).digest("hex"),
    };
  });
}

/**
 * Every journal entry at or below the applied watermark must have a matching
 * row, on both hash and timestamp. An entry below the watermark with no row was
 * skipped by the watermark rule and never will be applied; a matching timestamp
 * with a different hash means the `.sql` file was edited after being applied,
 * which nothing else detects because Drizzle writes the hash but never reads it
 * back.
 *
 * Entries above the watermark are simply pending, which is the normal case.
 *
 * @param {{ entries: HashedJournalEntry[]; appliedMigrations: AppliedMigration[] }} input
 * @returns {JournalProblem[]}
 */
export function findJournalInconsistencies({ entries, appliedMigrations }) {
  const watermark = watermarkOf(appliedMigrations.map((migration) => migration.createdAt));

  if (watermark === undefined) {
    return [];
  }

  // A timestamp maps to the *set* of hashes recorded at it, not to a single
  // one: the identity of an applied migration is the (hash, created_at) pair,
  // so two entries sharing a `when` each have to be checked against every hash
  // at that timestamp rather than against whichever row was written last.
  /** @type {Map<number, Set<string>>} */
  const hashesByCreatedAt = new Map();

  for (const migration of appliedMigrations) {
    const hashes = hashesByCreatedAt.get(migration.createdAt) ?? new Set();

    hashes.add(migration.hash);
    hashesByCreatedAt.set(migration.createdAt, hashes);
  }

  /** @type {JournalProblem[]} */
  const problems = [];

  for (const entry of entries) {
    if (entry.when > watermark) {
      continue;
    }

    const appliedHashes = hashesByCreatedAt.get(entry.when);

    if (appliedHashes === undefined) {
      problems.push({
        tag: entry.tag,
        when: entry.when,
        reason: "not-applied",
      });
      continue;
    }

    if (!appliedHashes.has(entry.hash)) {
      problems.push({
        tag: entry.tag,
        when: entry.when,
        reason: "hash-mismatch",
      });
    }
  }

  return problems;
}

/**
 * Consequence 1 again, caught one step earlier — in review, where the fix is a
 * rebase and a regenerate. A branch whose new migrations carry timestamps at or
 * below the newest migration already on the base branch would merge green (CI
 * builds a fresh database where everything applies in folder order) and then
 * never apply to production.
 *
 * @param {{ baseEntries: JournalEntry[]; headEntries: JournalEntry[] }} input
 * @returns {JournalProblem[]}
 */
export function findOutOfOrderEntries({ baseEntries, headEntries }) {
  const baseWatermark = watermarkOf(baseEntries.map((entry) => entry.when));

  if (baseWatermark === undefined) {
    return [];
  }

  // What is "already on base" is decided by tag, not by timestamp: an entry new
  // to this branch that happens to share a `when` with one on base is precisely
  // the case that has to fail, since Drizzle applies only what is strictly
  // above the watermark.
  const baseTags = new Set(baseEntries.map((entry) => entry.tag));

  return headEntries
    .filter((entry) => !baseTags.has(entry.tag) && entry.when <= baseWatermark)
    .map(
      (entry) =>
        /** @type {JournalProblem} */ ({
          tag: entry.tag,
          when: entry.when,
          reason: "out-of-order",
        }),
    );
}

/**
 * Consequence 2 caught in review rather than at container start. An applied
 * migration's `.sql` file is a record of what ran, not source to keep tidy: its
 * bytes are frozen down to the comments, because the hash Drizzle compares
 * covers the whole file. The rule is absolute on purpose — "it is only a
 * comment" is exactly the reasoning that broke production once, and a migration
 * that is genuinely wrong is corrected by a new migration, never by an edit.
 *
 * "Already applied" is approximated by "already on the base branch", which is
 * stricter than the truth for a migration merged but not yet deployed. The
 * stricter rule is the one worth having: it is the one a reader can remember.
 *
 * @param {{ changes: MigrationFileChange[] }} input
 * @returns {MigrationFileProblem[]}
 */
export function findMutatedMigrationFiles({ changes }) {
  return changes
    .filter((change) => change.status !== "added")
    .map(
      (change) =>
        /** @type {MigrationFileProblem} */ ({
          path: change.path,
          reason: change.status,
        }),
    );
}

/**
 * The same rule applied to the journal, which `findMutatedMigrationFiles`
 * cannot judge: `_journal.json` is legitimately modified by every new
 * migration, so only its *contents* say whether the change was an append. An
 * entry already on base may not change its tag ordering or its timestamp and
 * may not disappear, since both are what pairs it with a row in
 * `drizzle.__drizzle_migrations`.
 *
 * @param {{ baseEntries: JournalEntry[]; headEntries: JournalEntry[] }} input
 * @returns {JournalProblem[]}
 */
export function findRewrittenJournalEntries({ baseEntries, headEntries }) {
  const headEntriesByTag = new Map(headEntries.map((entry) => [entry.tag, entry]));

  /** @type {JournalProblem[]} */
  const problems = [];

  for (const baseEntry of baseEntries) {
    const headEntry = headEntriesByTag.get(baseEntry.tag);

    if (headEntry === undefined) {
      problems.push({
        tag: baseEntry.tag,
        when: baseEntry.when,
        reason: "entry-removed",
      });
      continue;
    }

    if (headEntry.when !== baseEntry.when || headEntry.idx !== baseEntry.idx) {
      problems.push({
        tag: baseEntry.tag,
        when: baseEntry.when,
        reason: "entry-rewritten",
      });
    }
  }

  return problems;
}
