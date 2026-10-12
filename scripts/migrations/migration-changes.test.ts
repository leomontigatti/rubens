import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { migrationsPath, readMigrationChanges } from "./migration-changes.mjs";

/**
 * A throwaway repository is the only honest fixture here: the reason an added
 * migration is easy to miss is git's own behaviour, not this module's parsing.
 */
let repository: string;
let previousCwd: string;

function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function writeMigration(name: string, sql: string) {
  writeFileSync(join(repository, migrationsPath, name), sql);
}

beforeEach(() => {
  previousCwd = process.cwd();
  repository = mkdtempSync(join(tmpdir(), "migration-changes-"));
  mkdirSync(join(repository, migrationsPath), { recursive: true });

  git("init", "--initial-branch", "base");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeMigration("0001_applied.sql", "create table a ();\n");
  git("add", ".");
  git("commit", "-m", "base migration");

  process.chdir(repository);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(repository, { recursive: true, force: true });
});

describe("readMigrationChanges", () => {
  it("reports nothing when the working tree matches the base", () => {
    expect(readMigrationChanges("base")).toEqual([]);
  });

  it("reports a migration still untracked, which `git diff` never lists", () => {
    writeMigration("0002_new.sql", "alter table a drop column b;\n");

    expect(readMigrationChanges("base")).toEqual([
      { path: `${migrationsPath}/0002_new.sql`, status: "added" },
    ]);
  });

  it("reports a staged migration once, not twice", () => {
    writeMigration("0002_new.sql", "alter table a drop column b;\n");
    git("add", ".");

    expect(readMigrationChanges("base")).toEqual([
      { path: `${migrationsPath}/0002_new.sql`, status: "added" },
    ]);
  });

  it("reports an edit to an applied migration as a modification", () => {
    writeMigration("0001_applied.sql", "create table a (b int);\n");

    expect(readMigrationChanges("base")).toEqual([
      { path: `${migrationsPath}/0001_applied.sql`, status: "modified" },
    ]);
  });

  it("ignores anything that is not a .sql file", () => {
    writeFileSync(join(repository, migrationsPath, "notes.md"), "not sql\n");

    expect(readMigrationChanges("base")).toEqual([]);
  });

  it("returns undefined when the base ref cannot be resolved", () => {
    expect(readMigrationChanges("no-such-ref")).toBeUndefined();
  });
});
