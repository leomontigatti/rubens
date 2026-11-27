import { describe, expect, test } from "vite-plus/test";

import { migrationProblems } from "./check-migrations.ts";
import type { Migrations } from "./check-migrations.ts";

const entry = (idx: number) => ({
  idx,
  version: "6",
  when: 1_793_980_048_235 + idx,
  tag: `000${idx}_organization`,
  breakpoints: true,
});

const journalOf = (entries: unknown[], dialect = "sqlite") =>
  JSON.stringify({ version: "7", dialect, entries }, null, 2);

const main: Migrations = {
  sql: {
    "0000_organization.sql": "CREATE TABLE a (id integer);",
    "0001_organization.sql": "CREATE TABLE b (id integer);",
  },
  journal: journalOf([entry(0), entry(1)]),
};

describe("frozen migrations", () => {
  test("passes the migrations on main unchanged, with a new one appended", () => {
    expect(
      migrationProblems(main, {
        sql: { ...main.sql, "0002_organization.sql": "CREATE TABLE c (id integer);" },
        journal: journalOf([entry(0), entry(1), entry(2)]),
      }),
    ).toEqual([]);
  });

  test("passes a journal written with other whitespace", () => {
    expect(
      migrationProblems(main, {
        ...main,
        journal: JSON.stringify({ version: "7", dialect: "sqlite", entries: [entry(0), entry(1)] }),
      }),
    ).toEqual([]);
  });

  test("reports a migration on main that was edited or deleted", () => {
    const problems = migrationProblems(main, {
      ...main,
      sql: { "0000_organization.sql": "CREATE TABLE a (id integer, name text);" },
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("0000_organization.sql");
    expect(problems[0]).toContain("edited");
    expect(problems[1]).toContain("0001_organization.sql");
    expect(problems[1]).toContain("deleted");
  });

  test("reports a journal entry on main that was changed, removed or moved", () => {
    for (const entries of [
      [entry(0), { ...entry(1), when: 1 }],
      [entry(0)],
      [entry(1), entry(0)],
      [entry(0), entry(2), entry(1)],
    ]) {
      const problems = migrationProblems(main, { ...main, journal: journalOf(entries) });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("_journal.json");
    }
  });

  test("reports an appended entry that reuses a migration, skips one or is not later than the last", () => {
    for (const appended of [
      { ...entry(0), when: entry(1).when + 1 },
      entry(3),
      { ...entry(2), when: entry(1).when },
    ]) {
      const problems = migrationProblems(main, {
        sql: { ...main.sql, "0002_organization.sql": "CREATE TABLE c (id integer);" },
        journal: journalOf([entry(0), entry(1), appended]),
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("next migration");
    }
  });

  test("reports a journal whose other fields changed, or that cannot be read", () => {
    for (const journal of [journalOf([entry(0), entry(1)], "postgresql"), "{", undefined]) {
      const problems = migrationProblems(main, { ...main, journal });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("_journal.json");
    }
  });
});
