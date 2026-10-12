import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareAdvisories, formatAdvisory, parseAuditReport } from "./dependencies/audit.mjs";

/**
 * Fails a branch on the high and critical advisories it *introduces*, by
 * auditing its tree and the base ref's and reporting the difference.
 *
 * Why the difference and not the whole tree is explained once, in
 * scripts/dependencies/audit.mjs, next to the comparison it justifies. This
 * file is the I/O half: where the two trees come from and how a failure reads.
 *
 * Neither run installs anything: `pnpm audit` resolves the tree from the
 * lockfile and asks the registry, so the base side is just the base ref's
 * `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` in a temp
 * directory (~1 s a run). Carrying `pnpm-workspace.yaml` across is also what
 * makes the accepted-advisory list apply to both sides: an entry added there
 * suppresses the advisory on the head and the base alike, so accepting one
 * never reads as "the branch fixed it".
 *
 * Runs in CI and locally, so the GitHub Actions annotation prefixes are only
 * emitted under Actions, where they mean something.
 *
 * Usage: node scripts/check-dependency-audit.mjs [base-ref]
 */

const baseRef = process.argv[2] ?? "origin/main";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const errorPrefix = isGitHubActions ? "::error::" : "";

/** The files `pnpm audit` reads. Everything else in the repo is irrelevant to it. */
const auditedFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

// `--prod`, because a dev-only advisory is not shipped: it can only be reached
// by someone already running this repo's own build. `--audit-level=high` is
// what the report is filtered to, so moderate and below never reach the
// comparison. Not `--ignore-registry-errors`, which would turn an unreachable
// registry into a green run that audited nothing.
const auditArguments = ["audit", "--prod", "--audit-level=high", "--json"];

/**
 * @param {string} cwd
 * @param {string} label
 * @returns {import("./dependencies/audit.mjs").Advisory[]}
 */
function audit(cwd, label) {
  const result = spawnSync("pnpm", auditArguments, { cwd, encoding: "utf8" });

  try {
    return parseAuditReport(result.stdout);
  } catch (error) {
    console.error(
      `${errorPrefix}The audit of ${label} did not complete: ` +
        `${error instanceof Error ? error.message : String(error)} ` +
        `A registry or network failure is the usual cause, and it is reported ` +
        `rather than ignored so an unaudited run never reads as a clean one.`,
    );
    console.error(result.stdout || result.stderr);
    process.exit(1);
  }
}

/**
 * The base ref's three files, written to a temp directory `pnpm audit` can run
 * in. `undefined` when the ref cannot be resolved, which every caller reads as
 * "nothing to compare against".
 *
 * @returns {string | undefined}
 */
function checkoutBaseFiles() {
  /** @type {[string, string][]} */
  const files = [];

  for (const file of auditedFiles) {
    const result = spawnSync("git", ["show", `${baseRef}:${file}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });

    if (result.status !== 0) {
      return undefined;
    }

    files.push([file, result.stdout]);
  }

  const directory = mkdtempSync(join(tmpdir(), "dependency-audit-"));

  for (const [file, contents] of files) {
    writeFileSync(join(directory, file), contents);
  }

  return directory;
}

const baseDirectory = checkoutBaseFiles();

if (baseDirectory === undefined) {
  // Under Actions the job fetches the base ref a step earlier, so failing to
  // read it means the workflow broke, not that the checkout is shallow — and a
  // gate that compared nothing must not report success, for the same reason a
  // registry failure does not. Locally it is routine (a clone with no remote),
  // and there is genuinely nothing to compare.
  if (isGitHubActions) {
    console.error(
      `${errorPrefix}${baseRef} could not be read, so no advisory was ` +
        `compared. The job is expected to fetch it — ` +
        `\`git fetch --no-tags --depth=1 origin main\` — before this step.`,
    );
    process.exit(1);
  }

  console.log(`${baseRef} could not be resolved; nothing to compare against.`);
  process.exit(0);
}

// `process.exit` does not unwind the stack, so a `finally` around the audits
// would never run on the path that needs it most: the one where `audit` exits
// on a registry failure. The exit event fires for every ending, and `rmSync` is
// synchronous, which is all a handler there is allowed to be.
process.on("exit", () => {
  rmSync(baseDirectory, { recursive: true, force: true });
});

const headAdvisories = audit(process.cwd(), "this branch");
const baseAdvisories = audit(baseDirectory, baseRef);

const { introduced, inherited } = compareAdvisories(headAdvisories, baseAdvisories);

for (const advisory of inherited) {
  console.log(
    `Already on ${baseRef}, inherited rather than introduced: ` + `${formatAdvisory(advisory)}`,
  );
}

for (const advisory of introduced) {
  console.error(
    `${errorPrefix}${formatAdvisory(advisory)} ` +
      `This branch adds it and ${baseRef} does not. Upgrade the package, or — ` +
      `if there is no fix and the path is unreachable — add the GHSA to ` +
      `audit.ignore in pnpm-workspace.yaml with a comment giving ` +
      `the reason and when to recheck.`,
  );
}

if (introduced.length > 0) {
  process.exit(1);
}

console.log(
  `No high or critical advisory introduced since ${baseRef}` +
    `${inherited.length > 0 ? `, with ${inherited.length} inherited` : ""}.`,
);
