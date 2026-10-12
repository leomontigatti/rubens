/**
 * Pure reasoning about a pair of `pnpm audit` runs, shared by
 * scripts/check-dependency-audit.mjs and its tests.
 *
 * The gate compares two trees — the branch's and the base ref's — and fails
 * only on the high and critical advisories the branch *introduces*. An
 * advisory both sides carry is inherited from `main`, and failing on it
 * would turn every open PR red the day a CVE is disclosed against a dependency
 * nobody on that branch touched, AFK branches included. Dependabot alerts
 * cover the full tree for that case; this gate covers the delta.
 *
 * Advisories are keyed by GHSA id rather than by pnpm's numeric `id`: the GHSA
 * is the identifier the advisory is published under, the one an ignore entry is
 * written against, and the one a human can look up.
 *
 * @typedef {{ version: string; paths: string[]; dev: boolean; optional: boolean; bundled: boolean }} AuditFinding
 * @typedef {{ id: number; title: string; module_name: string; vulnerable_versions: string; patched_versions: string; severity: string; github_advisory_id: string; url: string; findings: AuditFinding[] }} Advisory
 * @typedef {{ introduced: Advisory[]; inherited: Advisory[] }} ComparedAdvisories
 */

/**
 * Reads the report `pnpm audit --json` writes on stdout. pnpm exits non-zero
 * whenever it reports anything at or above `--audit-level`, so the exit code
 * says nothing about whether the run succeeded — only the output does.
 *
 * Throws when stdout is not a report, which is how a registry or network
 * failure reaches the caller: the alternative is passing silently on a run
 * that audited nothing.
 *
 * @param {string} stdout
 * @returns {Advisory[]}
 */
export function parseAuditReport(stdout) {
  /** @type {unknown} */
  let report;

  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error("`pnpm audit` did not produce a JSON report.");
  }

  if (
    report === null ||
    typeof report !== "object" ||
    !("advisories" in report) ||
    typeof report.advisories !== "object" ||
    report.advisories === null
  ) {
    throw new Error("`pnpm audit` produced a JSON report with no advisories.");
  }

  return Object.values(/** @type {Record<string, Advisory>} */ (report.advisories));
}

/**
 * Splits the head's advisories against the base's, keyed by GHSA id.
 *
 * Only the head side decides: an advisory the base carries and the head does
 * not has already been fixed by the branch, and there is nothing to report.
 *
 * @param {Advisory[]} headAdvisories
 * @param {Advisory[]} baseAdvisories
 * @returns {ComparedAdvisories}
 */
export function compareAdvisories(headAdvisories, baseAdvisories) {
  const onBase = new Set(baseAdvisories.map((advisory) => advisory.github_advisory_id));

  return {
    introduced: headAdvisories.filter((advisory) => !onBase.has(advisory.github_advisory_id)),
    inherited: headAdvisories.filter((advisory) => onBase.has(advisory.github_advisory_id)),
  };
}

/**
 * One line per advisory, naming the package, the GHSA, one dependency path and
 * the patched range — everything needed to decide between upgrading and
 * accepting it, without opening the report.
 *
 * The first path is enough: a package reached through five paths is still the
 * same package to upgrade, and printing all five buries the advisory.
 *
 * @param {Advisory} advisory
 * @returns {string}
 */
export function formatAdvisory(advisory) {
  const [finding] = advisory.findings;
  // An advisory with no finding, or a finding with no path, is not a shape
  // `pnpm audit` emits — but this line is the only thing a human reads about a
  // failure, so it degrades to the package name rather than printing
  // "Path: undefined" and sending them to the raw report.
  const path = finding?.paths[0] ?? advisory.module_name;
  const version = finding === undefined ? "" : `@${finding.version}`;
  // Advisory titles are written as sentences but only sometimes punctuated as
  // one, so the separator is added rather than assumed.
  const title = advisory.title.replace(/\.\s*$/, "");

  return (
    `${advisory.severity} ${advisory.github_advisory_id} in ` +
    `${advisory.module_name}${version}: ${title}. ` +
    `Path: ${path}. Patched in ${advisory.patched_versions}. ${advisory.url}`
  );
}
