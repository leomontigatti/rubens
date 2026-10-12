/**
 * Pure reasoning about a squawk run over newly added migrations, shared by
 * scripts/check-migration-safety.mjs and its tests.
 *
 * squawk lints a migration's SQL for two unrelated hazards, and this repo
 * cares about them at different strengths:
 *
 * 1. **Compatibility with the code still running.** Coolify keeps the old
 *    container serving while the new one migrates, so a dropped or renamed
 *    object breaks the old code's queries for the length of the deploy. An
 *    identifier over 63 characters is the same class of break: Postgres
 *    truncates it silently, so the object no longer answers to the name
 *    `schema.ts` uses. Those findings block.
 * 2. **Lock hazards.** A table scan or an exclusive lock taken while writes
 *    queue behind it. Harmless at this repo's table sizes and expensive at
 *    scale, so they are reported and merge anyway.
 *
 * Everything squawk reports that is not in `blockingRules` falls in the second
 * tier by construction, so a rule added by a later squawk release warns rather
 * than blocking a branch that never asked for it.
 *
 * @typedef {{ file: string; line: number; column: number; level: string; message: string; help: string | null; rule_name: string }} SquawkFinding
 * @typedef {{ blocking: SquawkFinding[]; warnings: SquawkFinding[] }} ClassifiedSquawkFindings
 */

/**
 * Rules squawk must not run at all, each for a reason that makes the finding
 * unactionable here rather than merely tolerable.
 */
export const excludedRules = [
  // Generator noise: `pnpm db:generate` writes the .sql, and the .sql is
  // immutable once applied. `prefer-robust-stmts` asks for `IF NOT EXISTS`
  // guards Drizzle does not emit.
  "prefer-robust-stmts",
  // A `schema.ts` decision, not a migration one: the column type comes from the
  // Drizzle schema, so the argument belongs in review of the schema change.
  "prefer-text-field",
  "prefer-bigint-over-int",
  // `CONCURRENTLY` cannot run inside a transaction block, and Drizzle's migrator
  // applies every pending migration inside one (`pg-core/dialect.js` migrate).
  "require-concurrent-index-creation",
  "require-concurrent-index-deletion",
  // Both are set at session level by scripts/migrate.mjs, on the connection the
  // migrator uses. squawk only reads the .sql, so it cannot see them.
  "require-lock-timeout",
  "require-statement-timeout",
];

/** Findings that fail the branch; everything else squawk reports is a warning. */
export const blockingRules = [
  "ban-drop-column",
  "ban-drop-table",
  "renaming-column",
  "renaming-table",
  "identifier-too-long",
];

/**
 * @param {SquawkFinding[]} findings
 * @returns {ClassifiedSquawkFindings}
 */
export function classifySquawkFindings(findings) {
  return {
    blocking: findings.filter((finding) => blockingRules.includes(finding.rule_name)),
    warnings: findings.filter((finding) => !blockingRules.includes(finding.rule_name)),
  };
}

/**
 * One line per finding, in the `path:line` shape an editor and an Actions
 * annotation both read. squawk counts lines from zero.
 *
 * @param {SquawkFinding} finding
 * @param {(reportedPath: string) => string} toDisplayPath
 * @returns {string}
 */
export function formatSquawkFinding(finding, toDisplayPath) {
  const help = finding.help === null ? "" : ` ${finding.help}`;

  return (
    `${toDisplayPath(finding.file)}:${finding.line + 1} ` +
    `[${finding.rule_name}] ${finding.message}${help}`
  );
}
