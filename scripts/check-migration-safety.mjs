import { spawnSync } from "node:child_process";

import { migrationsPath, readMigrationChanges } from "./migrations/migration-changes.mjs";
import {
  classifySquawkFindings,
  excludedRules,
  formatSquawkFinding,
} from "./migrations/squawk.mjs";

/**
 * Lints the migrations a branch *adds* with squawk, and splits what it reports
 * into a tier that fails the branch and a tier that only reports. Which rule
 * lands where, and why, is explained once in scripts/migrations/squawk.mjs.
 *
 * Only added files are linted, so an applied migration is never re-judged: a
 * rule squawk gains later cannot retroactively fail a branch that did not touch
 * the file, and a `-- squawk-ignore` written before merge stays the permanent
 * record of the exception, frozen by check-migration-immutability.mjs.
 *
 * Runs in CI and locally, so the GitHub Actions annotation prefixes are only
 * emitted under Actions, where they mean something.
 *
 * Usage: node scripts/check-migration-safety.mjs [base-ref]
 */

const baseRef = process.argv[2] ?? "origin/main";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const errorPrefix = isGitHubActions ? "::error::" : "";
const warningPrefix = isGitHubActions ? "::warning::" : "";

// Pinned to an exact version, through `pnpm dlx` rather than `npx` so pnpm's
// `minimumReleaseAge` applies to the download.
const squawkPackage = "squawk-cli@2.65.0";

// `--assume-in-transaction` because Drizzle's migrator wraps every pending
// migration in one transaction (`drizzle-orm/pg-core/dialect.js` migrate), so
// squawk must not ask for a `BEGIN` the file does not carry.
const squawkArguments = [
  "--pg-version",
  "17.0",
  "--assume-in-transaction",
  "--reporter",
  "json",
  "--exclude",
  excludedRules.join(","),
];

/**
 * @param {string[]} paths
 * @returns {import("./migrations/squawk.mjs").SquawkFinding[]}
 */
function runSquawk(paths) {
  const result = spawnSync("pnpm", ["dlx", squawkPackage, ...squawkArguments, ...paths], {
    encoding: "utf8",
  });

  // squawk exits non-zero whenever it reports anything, so the exit code says
  // nothing about which tier the findings fall in. Only unparseable output is
  // an actual failure of the run.
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error(`${errorPrefix}squawk could not be run over the new migrations.`);
    console.error(result.stdout || result.stderr);
    process.exit(1);
  }
}

const changes = readMigrationChanges(baseRef);

if (changes === undefined) {
  console.log(`${baseRef} could not be resolved; nothing to compare against.`);
  process.exit(0);
}

const addedPaths = changes
  .filter((change) => change.status === "added")
  .map((change) => change.path);

if (addedPaths.length === 0) {
  console.log(`No migration added since ${baseRef}; squawk not run.`);
  process.exit(0);
}

const { blocking, warnings } = classifySquawkFindings(runSquawk(addedPaths));

// squawk echoes back the paths it was given, which are already relative to the
// repo root; the display step exists for the absolute paths it reports when a
// caller passes one, and leaves anything else untouched.
const toDisplayPath = (/** @type {string} */ path) => {
  const start = path.indexOf(migrationsPath);

  return start === -1 ? path : path.slice(start);
};

for (const finding of warnings) {
  console.warn(
    `${warningPrefix}${formatSquawkFinding(finding, toDisplayPath)} ` +
      `Not blocking: lock hazards are harmless at today's table sizes, and a rule ` +
      `new to squawk warns rather than failing a branch that never asked for it. ` +
      `The rules and their reasons are in scripts/migrations/squawk.mjs.`,
  );
}

for (const finding of blocking) {
  console.error(
    `${errorPrefix}${formatSquawkFinding(finding, toDisplayPath)} ` +
      `The old container keeps serving while the new one migrates, so this breaks ` +
      `the running code's queries. Split it into expand and contract, or — once no ` +
      `running code reads the object — mark the statement with a -- reason: comment ` +
      `and -- squawk-ignore ${finding.rule_name} on the line before it. ` +
      `The rules and their reasons are in scripts/migrations/squawk.mjs.`,
  );
}

if (blocking.length > 0) {
  process.exit(1);
}

console.log(
  `${addedPaths.length} migration(s) added since ${baseRef} are safe to deploy` +
    `${warnings.length > 0 ? `, with ${warnings.length} warning(s)` : ""}.`,
);
