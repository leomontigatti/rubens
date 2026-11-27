import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

// Migrations on main are frozen.
//
// A migration on `main` has run in deployed organization objects, which record the
// `when` of the newest one applied and run only the entries later than it
// (docs/agents/coding-standards.md#underthing-rules). So an edit to one, or a journal
// that does anything but append, leaves deployed objects on a schema the code no
// longer describes. This check compares what is staged with `origin/main`: every
// `.sql` there is unchanged here, the journal's entries there are the first of its
// entries here, and each entry after them names the next migration, later than the
// one before, as drizzle reads them.

export const migrationsDirectory = "src/organization/migrations";
const journalPath = "meta/_journal.json";
const fix = "a schema change adds a new migration (`pnpm organization:generate`)";

/** The migrations' SQL by file name, and the journal's text. */
export type Migrations = { sql: Record<string, string>; journal: string | undefined };

const journalSchema = z.record(z.string(), z.unknown());
// An entry drizzle runs: the SQL it reads by `idx`, run when `when` is newer than
// the last one an object applied.
const entrySchema = z.looseObject({ idx: z.number(), when: z.number() });

function parsed(journal: string | undefined): Record<string, unknown> | undefined {
  if (journal === undefined) return undefined;
  try {
    return journalSchema.parse(JSON.parse(journal));
  } catch {
    return undefined;
  }
}

// Whether the entries after `from` each name the next migration, later than the one before.
function appendsInOrder(entries: unknown[], from: number): boolean {
  const read = z.array(entrySchema).safeParse(entries);
  if (!read.success) return false;
  return read.data.every(
    (entry, index) =>
      index < from ||
      (entry.idx === index && entry.when > (read.data[index - 1]?.when ?? -Infinity)),
  );
}

function journalProblem(base: Migrations, current: Migrations): string | undefined {
  const where = `${migrationsDirectory}/${journalPath}`;
  const before = parsed(base.journal);
  if (!before) return undefined;
  const after = parsed(current.journal);
  if (!after) return `${where}: missing or not JSON. Restore it from origin/main.`;
  const { entries: entriesBefore, ...restBefore } = before;
  const { entries: entriesAfter, ...restAfter } = after;
  const appended =
    Array.isArray(entriesBefore) &&
    Array.isArray(entriesAfter) &&
    isDeepStrictEqual(entriesAfter.slice(0, entriesBefore.length), entriesBefore) &&
    isDeepStrictEqual(restAfter, restBefore);
  if (!appended) {
    return `${where}: changed beyond appending entries to origin/main's. Restore its entries and fields from origin/main; ${fix}.`;
  }
  if (!appendsInOrder(entriesAfter, entriesBefore.length)) {
    return `${where}: an appended entry does not name the next migration, later than the last: deployed objects would rerun a frozen one or skip it. Regenerate it with \`pnpm organization:generate\`.`;
  }
  return undefined;
}

export function migrationProblems(base: Migrations, current: Migrations): string[] {
  const sqlProblems = Object.keys(base.sql)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((file) => {
      const where = `${migrationsDirectory}/${file}`;
      const now = current.sql[file];
      if (now === undefined) return `${where}: on origin/main, deleted here. Restore it; ${fix}.`;
      if (now !== base.sql[file]) {
        return `${where}: on origin/main, edited here. Deployed objects already ran it: restore it from origin/main; ${fix}.`;
      }
      return [];
    });
  const journal = journalProblem(base, current);
  return journal ? [...sqlProblems, journal] : sqlProblems;
}

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" });

function mainMigrations(): Migrations {
  const files = git(["ls-tree", "-r", "--name-only", "origin/main", "--", migrationsDirectory])
    .split("\n")
    .filter((file) => file.endsWith(".sql"));
  const journal = `${migrationsDirectory}/${journalPath}`;
  const journalOnMain = spawnSync("git", ["cat-file", "-e", `origin/main:${journal}`]).status === 0;
  return {
    sql: Object.fromEntries(
      files.map((file) => [path.basename(file), git(["show", `origin/main:${file}`])]),
    ),
    journal: journalOnMain ? git(["show", `origin/main:${journal}`]) : undefined,
  };
}

// The staged version, which is what a commit takes; in CI it is the checkout.
function stagedMigrations(base: Migrations): Migrations {
  const read = (file: string) => {
    const at = `:${migrationsDirectory}/${file}`;
    return spawnSync("git", ["cat-file", "-e", at]).status === 0 ? git(["show", at]) : undefined;
  };
  return {
    sql: Object.fromEntries(
      Object.keys(base.sql).flatMap((file) => {
        const text = read(file);
        return text === undefined ? [] : [[file, text]];
      }),
    ),
    journal: read(journalPath),
  };
}

function main(): void {
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]).status !== 0) {
    console.error(
      "check:migrations: origin/main is missing, so no migration can be checked against it. Run `git fetch origin main` and check again.",
    );
    process.exitCode = 1;
    return;
  }
  const base = mainMigrations();
  const problems = migrationProblems(base, stagedMigrations(base));
  if (problems.length === 0) return;
  console.error(
    ["Migrations on origin/main changed:", ...problems.map((p) => `- ${p}`)].join("\n"),
  );
  process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) main();
