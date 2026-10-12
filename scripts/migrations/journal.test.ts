import { describe, expect, it } from "vite-plus/test";

import {
  findJournalInconsistencies,
  findMutatedMigrationFiles,
  findOutOfOrderEntries,
  findRewrittenJournalEntries,
} from "./journal.mjs";

function journalEntry(idx: number, when: number) {
  return { idx, tag: `000${idx}_migration`, when, hash: `hash-${idx}` };
}

describe("findJournalInconsistencies", () => {
  it("accepts a journal whose applied entries all match", () => {
    const entries = [journalEntry(0, 100), journalEntry(1, 200)];

    expect(
      findJournalInconsistencies({
        entries,
        appliedMigrations: [
          { hash: "hash-0", createdAt: 100 },
          { hash: "hash-1", createdAt: 200 },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts a database Drizzle has never migrated", () => {
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100)],
        appliedMigrations: [],
      }),
    ).toEqual([]);
  });

  it("ignores entries above the watermark, which are simply pending", () => {
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100), journalEntry(1, 200)],
        appliedMigrations: [{ hash: "hash-0", createdAt: 100 }],
      }),
    ).toEqual([]);
  });

  it("reports a migration the watermark rule skipped for good", () => {
    // The classic out-of-order merge: 0001 landed after 0002 was applied, so
    // Drizzle's high-water mark has already moved past it.
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100), journalEntry(1, 150), journalEntry(2, 200)],
        appliedMigrations: [
          { hash: "hash-0", createdAt: 100 },
          { hash: "hash-2", createdAt: 200 },
        ],
      }),
    ).toEqual([{ tag: "0001_migration", when: 150, reason: "not-applied" }]);
  });

  it("reports a migration file edited after it was applied", () => {
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100)],
        appliedMigrations: [{ hash: "hash-from-before-the-edit", createdAt: 100 }],
      }),
    ).toEqual([{ tag: "0000_migration", when: 100, reason: "hash-mismatch" }]);
  });

  it("matches on the (hash, created_at) pair when two entries share a timestamp", () => {
    // Keying applied rows by timestamp alone would check one entry against the
    // other's hash and report a spurious mismatch.
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100), journalEntry(1, 100)],
        appliedMigrations: [
          { hash: "hash-0", createdAt: 100 },
          { hash: "hash-1", createdAt: 100 },
        ],
      }),
    ).toEqual([]);
  });

  it("reports an entry whose hash is absent even when its timestamp is present", () => {
    expect(
      findJournalInconsistencies({
        entries: [journalEntry(0, 100), journalEntry(1, 100)],
        appliedMigrations: [{ hash: "hash-0", createdAt: 100 }],
      }),
    ).toEqual([{ tag: "0001_migration", when: 100, reason: "hash-mismatch" }]);
  });
});

describe("findOutOfOrderEntries", () => {
  it("accepts a branch whose new migration postdates the base branch", () => {
    expect(
      findOutOfOrderEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100), journalEntry(1, 200), journalEntry(2, 300)],
      }),
    ).toEqual([]);
  });

  it("rejects a branch whose new migration predates the base branch", () => {
    expect(
      findOutOfOrderEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100), journalEntry(1, 200), journalEntry(2, 150)],
      }),
    ).toEqual([{ tag: "0002_migration", when: 150, reason: "out-of-order" }]);
  });

  it("rejects a new migration whose timestamp ties the base watermark", () => {
    // Drizzle applies only what is *strictly* above the watermark, so a tie
    // never runs. Excluding entries by timestamp rather than by tag would let
    // this one through.
    expect(
      findOutOfOrderEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100), journalEntry(1, 200), journalEntry(2, 200)],
      }),
    ).toEqual([{ tag: "0002_migration", when: 200, reason: "out-of-order" }]);
  });

  it("accepts any branch when the base has no migrations yet", () => {
    expect(
      findOutOfOrderEntries({
        baseEntries: [],
        headEntries: [journalEntry(0, 100)],
      }),
    ).toEqual([]);
  });
});

describe("findMutatedMigrationFiles", () => {
  it("accepts a branch that only adds migrations", () => {
    expect(
      findMutatedMigrationFiles({
        changes: [
          { path: "src/db/migrations/0008_new.sql", status: "added" },
          { path: "src/db/migrations/0009_new.sql", status: "added" },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects an edit to a migration already on the base branch", () => {
    // The incident this check exists for: a vocabulary sweep rewrote a comment
    // inside an applied migration, which changed its hash and stopped every
    // deploy after it.
    expect(
      findMutatedMigrationFiles({
        changes: [
          {
            path: "src/db/migrations/0007_strange_mantis.sql",
            status: "modified",
          },
          { path: "src/db/migrations/0008_new.sql", status: "added" },
        ],
      }),
    ).toEqual([{ path: "src/db/migrations/0007_strange_mantis.sql", reason: "modified" }]);
  });

  it("rejects a deleted or renamed migration", () => {
    expect(
      findMutatedMigrationFiles({
        changes: [
          { path: "src/db/migrations/0006_gone.sql", status: "removed" },
          { path: "src/db/migrations/0007_old_name.sql", status: "renamed" },
        ],
      }),
    ).toEqual([
      { path: "src/db/migrations/0006_gone.sql", reason: "removed" },
      { path: "src/db/migrations/0007_old_name.sql", reason: "renamed" },
    ]);
  });
});

describe("findRewrittenJournalEntries", () => {
  it("accepts a journal that only gained an entry", () => {
    expect(
      findRewrittenJournalEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100), journalEntry(1, 200), journalEntry(2, 300)],
      }),
    ).toEqual([]);
  });

  it("rejects a base entry whose timestamp moved", () => {
    // The timestamp is what pairs the entry with its applied row, so moving it
    // orphans the migration as surely as deleting it.
    expect(
      findRewrittenJournalEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100), journalEntry(1, 250)],
      }),
    ).toEqual([{ tag: "0001_migration", when: 200, reason: "entry-rewritten" }]);
  });

  it("rejects a base entry that disappeared", () => {
    expect(
      findRewrittenJournalEntries({
        baseEntries: [journalEntry(0, 100), journalEntry(1, 200)],
        headEntries: [journalEntry(0, 100)],
      }),
    ).toEqual([{ tag: "0001_migration", when: 200, reason: "entry-removed" }]);
  });

  it("accepts any branch when the base has no migrations yet", () => {
    expect(
      findRewrittenJournalEntries({
        baseEntries: [],
        headEntries: [journalEntry(0, 100)],
      }),
    ).toEqual([]);
  });
});
