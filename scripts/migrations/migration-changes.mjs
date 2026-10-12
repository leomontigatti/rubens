import { spawnSync } from "node:child_process";

/**
 * What a branch did to the migration files, read from git. Shared by the two
 * checks that need it for opposite reasons: immutability refuses a file the
 * branch *changed*, safety lints the files it *added*.
 *
 * @typedef {import("./journal.mjs").MigrationFileChange} MigrationFileChange
 * @typedef {import("./journal.mjs").MigrationFileChangeStatus} MigrationFileChangeStatus
 */

export const migrationsPath = "src/db/migrations";

/**
 * Diffs the base tip against the working tree, not a `base...HEAD` range: CI
 * fetches main at depth 1 and checks out a merge commit, so no merge base is
 * available to resolve — and none is needed, since that merge commit already
 * carries main's own migrations. Reading the working tree rather than a
 * commit also catches the change locally, before it is committed — including a
 * migration still untracked, which `git diff` alone would never list.
 *
 * `undefined` when the base ref cannot be resolved, which every caller reads as
 * "nothing to compare against yet".
 *
 * @param {string} baseRef
 * @returns {MigrationFileChange[] | undefined}
 */
export function readMigrationChanges(baseRef) {
  const result = spawnSync("git", ["diff", "--name-status", baseRef, "--", migrationsPath], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return undefined;
  }

  return [...parseNameStatus(result.stdout), ...readUntrackedMigrations()];
}

/**
 * @param {string} nameStatus
 * @returns {MigrationFileChange[]}
 */
function parseNameStatus(nameStatus) {
  return nameStatus
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      // Tab-separated, and a rename carries two paths: `R100 old new`. The old
      // path is the one that was already applied, so it is the one to report.
      const [status, path] = line.split("\t");

      if (!path.endsWith(".sql")) {
        return [];
      }

      return [{ path, status: changeStatusOf(status) }];
    });
}

/**
 * `git diff` never lists an untracked file, so a migration that
 * `pnpm db:generate` has just written would read as "nothing added" until it is
 * staged — a false green for the check that exists precisely for that file.
 * Reading them separately is what makes "the working tree, not a range" true
 * for an addition too.
 *
 * @returns {MigrationFileChange[]}
 */
function readUntrackedMigrations() {
  const result = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", migrationsPath],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .filter((path) => path.endsWith(".sql"))
    .map((path) => ({ path, status: /** @type {const} */ ("added") }));
}

/**
 * @param {string} nameStatus
 * @returns {MigrationFileChangeStatus}
 */
function changeStatusOf(nameStatus) {
  if (nameStatus.startsWith("A")) {
    return "added";
  }

  if (nameStatus.startsWith("D")) {
    return "removed";
  }

  // A rename carries a similarity score (`R100`), so the prefix is what
  // identifies it. Everything left is a modification of some kind.
  return nameStatus.startsWith("R") ? "renamed" : "modified";
}
