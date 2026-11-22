import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";
import { z } from "zod";

// The ban on type assertions, held by a ratchet.
//
// Lint rejects `as T` and `<T>x` (`typescript/consistent-type-assertions`, never;
// `as const` passes). The files that held one when the rule landed are allowed
// theirs, counted per file in `type-assertion-allowlist.json`, and vite.config.ts
// builds the override that turns the rule off for them from that list, the shared
// utilities that exist to hold a cast included. Oxlint has
// no baseline, so this check keeps the list honest: each entry is the file's
// count, no entry rises above origin/main's, the override names exactly the
// listed files, and no comment disables the rule.

export const ruleName = "typescript/consistent-type-assertions";
export const allowlistPath = "scripts/type-assertion-allowlist.json";
const standards = "docs/agents/coding-standards.md#type-assertions";
const write = "`pnpm check:type-assertions --write`";

/** Files allowed their assertions, with how many. Both lists are held to their counts. */
export type Allowlist = {
  /** The shared utilities that exist to hold a cast for their callers. */
  sharedUtilities: Record<string, number>;
  /** Every other file that held assertions when the rule landed. */
  files: Record<string, number>;
};

const entriesOf = (list: Allowlist): Record<string, number> => ({
  ...list.sharedUtilities,
  ...list.files,
});

export type BaseAllowlist =
  | { state: "read"; allowlist: Allowlist }
  // origin/main predates the ratchet: there is nothing to compare with yet.
  | { state: "absent" }
  | { state: "unreadable"; detail: string };

type LintOverride = { files: string[]; rules: Record<string, unknown> };

export type RatchetInput = {
  /** Assertions per file, as the rule counts them, the override aside. */
  counts: Record<string, number>;
  allowlist: Allowlist;
  base: BaseAllowlist;
  /** The resolved lint overrides (`vp lint --print-config`). */
  overrides: LintOverride[];
  disableComments: { file: string; line: number }[];
};

const byName = (left: string, right: string) => left.localeCompare(right);
const assertionsOf = (n: number) => `${n} type assertion${n === 1 ? "" : "s"}`;

function countProblems({ counts, allowlist }: RatchetInput): string[] {
  const entries = entriesOf(allowlist);
  const files = new Set([...Object.keys(counts), ...Object.keys(entries)]);
  return [...files].sort(byName).flatMap((file) => {
    const found = counts[file] ?? 0;
    const entry = entries[file] ?? 0;
    if (found > entry) {
      return `${file}: ${assertionsOf(found)}, the allowlist allows ${entry}. Replace the new one with a type guard, a schema or a typed helper (${standards}); the allowlist never rises.`;
    }
    if (found < entry) {
      return `${file}: ${assertionsOf(found)}, the allowlist says ${entry}. Lower its entry in this change: ${write}.`;
    }
    return [];
  });
}

function baseProblems({ allowlist, base }: RatchetInput): string[] {
  if (base.state === "absent") return [];
  if (base.state === "unreadable") {
    return [
      `Cannot read origin/main's ${allowlistPath} (${base.detail}), so no entry can be checked against it. Run \`git fetch origin main\` and check again.`,
    ];
  }
  const baseEntries = entriesOf(base.allowlist);
  return Object.entries(entriesOf(allowlist))
    .sort(([left], [right]) => byName(left, right))
    .flatMap(([file, entry]) => {
      const baseEntry = baseEntries[file];
      if (baseEntry === undefined) {
        return `${file}: allowlisted with ${entry}, but origin/main's list does not hold it. A new assertion is removed, not listed (${standards}).`;
      }
      if (entry > baseEntry) {
        return `${file}: allowlisted with ${entry}, origin/main's list allows ${baseEntry}. An entry only falls: remove the new assertion (${standards}).`;
      }
      return [];
    });
}

// A rule set to anything but an error, in an override, lets assertions through.
function exempts(setting: unknown): boolean {
  const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
  return severity !== "deny" && severity !== "error" && severity !== 2;
}

function overrideProblems({ allowlist, overrides }: RatchetInput): string[] {
  const listed = new Set(Object.keys(entriesOf(allowlist)));
  const exempted = new Set(
    overrides
      .filter((override) => ruleName in override.rules && exempts(override.rules[ruleName]))
      .flatMap((override) => override.files),
  );
  const extra = [...exempted]
    .filter((file) => !listed.has(file))
    .sort(byName)
    .map(
      (file) =>
        `The lint config turns ${ruleName} off for ${file}, which ${allowlistPath} does not list. Only vite.config.ts's override built from that list may exempt a file.`,
    );
  const missing = [...listed]
    .filter((file) => !exempted.has(file))
    .sort(byName)
    .map(
      (file) =>
        `${file}: listed in ${allowlistPath}, but no lint override turns ${ruleName} off for it. Build the override from the list in vite.config.ts.`,
    );
  return [...extra, ...missing];
}

function disableProblems({ disableComments }: RatchetInput): string[] {
  return disableComments.map(
    ({ file, line }) =>
      `${file}:${line}: a disable comment that names ${ruleName}, or no rule at all. The rule takes none: replace the assertion with a type guard, a schema or a typed helper (${standards}).`,
  );
}

/** Every way the tree, its allowlist and the lint config disagree; empty when they agree. */
export function ratchetProblems(input: RatchetInput): string[] {
  return [
    ...countProblems(input),
    ...baseProblems(input),
    ...overrideProblems(input),
    ...disableProblems(input),
  ];
}

const cannotParse = (file: string) =>
  new Error(`${file}: cannot parse it to count its type assertions and disable comments.`);

const directive = /(?:oxlint|eslint)-disable(?:-next-line|-line)?\b/;

/**
 * The 1-based lines of `source` where a comment that would silence the rule has its
 * directive. Comments come from oxc's parser, the one oxlint reads them with, so a
 * comment ends where oxlint's does; `file` picks the language (`.tsx` parses JSX).
 */
export function findDisableComments(source: string, file: string): number[] {
  const { comments, errors } = parseSync(file, source);
  // A file that does not parse would yield only the comments before its error.
  if (errors.length > 0) throw cannotParse(file);
  return comments.flatMap(({ value, start }) => {
    const found = directive.exec(value);
    if (!found) return [];
    const rules = value.slice(found.index + found[0].length);
    const silences = rules.includes("consistent-type-assertions") || /^\s*(?:--|$)/.test(rules);
    // `start` is the comment's opening `//` or `/*`, two characters before `value`.
    return silences ? [source.slice(0, start + 2 + found.index).split("\n").length] : [];
  });
}

function run(command: string, args: string[]) {
  // `vp` fails to start on an inherited non-TTY stdin; a pipe is fine.
  return spawnSync(command, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// The JSON `vp` prints follows a note on its first line.
function parseJson<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(JSON.parse(text.slice(text.indexOf("{"))));
}

const countsSchema = z.record(z.string(), z.number().int().positive());
const allowlistSchema = z.object({ sharedUtilities: countsSchema, files: countsSchema });

const readAllowlist = (text: string): Allowlist => parseJson(allowlistSchema, text);

function readBase(): BaseAllowlist {
  if (run("git", ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]).status !== 0) {
    return { state: "unreadable", detail: "origin/main is missing" };
  }
  if (run("git", ["cat-file", "-e", `origin/main:${allowlistPath}`]).status !== 0) {
    return { state: "absent" };
  }
  const shown = run("git", ["show", `origin/main:${allowlistPath}`]);
  try {
    return { state: "read", allowlist: readAllowlist(shown.stdout) };
  } catch (error) {
    return { state: "unreadable", detail: String(error) };
  }
}

const lintConfigSchema = z.object({
  overrides: z
    .array(z.object({ files: z.array(z.string()), rules: z.record(z.string(), z.unknown()) }))
    .default([]),
});

// What the count skips: vendored skills and generated code, as lint's own
// ignorePatterns in vite.config.ts. Kept here rather than read from there, so a
// path added to lint's ignores is still counted and must be listed.
const notCounted = [
  ".agents/skills/**",
  ".claude/skills/**",
  "src/routeTree.gen.ts",
  "src/organization/migrations/**",
  "worker-configuration.d.ts",
];

function resolvedLintConfig() {
  const printed = run("node_modules/.bin/vp", ["lint", "--print-config"]);
  if (printed.status !== 0) {
    throw new Error(`vp lint --print-config failed:\n${printed.stderr}`);
  }
  return parseJson(lintConfigSchema, printed.stdout);
}

// A parse error is the one diagnostic without a code.
const reportSchema = z.object({
  diagnostics: z.array(z.object({ code: z.string().optional(), filename: z.string() })),
});

// Every tracked source file but those in `notCounted`. Tracked, not what lint
// walks: lint skips a path `.gitignore` names even when its file is committed.
function trackedSourceFiles(): string[] {
  const extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
  return execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      ...extensions.map((extension) => `*.${extension}`),
      ...notCounted.map((pattern) => `:(exclude,glob)${pattern}`),
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file !== "" && existsSync(file));
}

// Oxlint's own binary, the one `vp lint` runs, with only this rule, no overrides,
// no nested configs and no ignore files: the count is what the rule reports with
// the allowlist empty.
export function countAssertions(files: string[]): Record<string, number> {
  const require = createRequire(import.meta.url);
  const fromVitePlus = createRequire(require.resolve("vite-plus/package.json"));
  const oxlint = path.join(path.dirname(fromVitePlus.resolve("oxlint/package.json")), "bin/oxlint");
  const directory = mkdtempSync(path.join(tmpdir(), "type-assertions-"));
  const config = path.join(directory, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      plugins: ["typescript"],
      categories: {},
      rules: { [ruleName]: ["error", { assertionStyle: "never" }] },
    }),
  );
  try {
    const linted = run(oxlint, [
      "-c",
      config,
      "--disable-nested-config",
      "--format",
      "json",
      "--no-ignore",
      ...files,
    ]);
    const { diagnostics } = parseJson(reportSchema, linted.stdout);
    const counts: Record<string, number> = {};
    for (const { code, filename } of diagnostics) {
      // A file that does not parse would count as none and `--write` would drop its entry.
      if (code === undefined) throw cannotParse(filename);
      if (code !== "typescript(consistent-type-assertions)") continue;
      counts[filename] = (counts[filename] ?? 0) + 1;
    }
    return counts;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const findAllDisableComments = (files: string[]) =>
  files.flatMap((file) =>
    findDisableComments(readFileSync(file, "utf8"), file).map((line) => ({ file, line })),
  );

function writeAllowlist(allowlist: Allowlist, counts: Record<string, number>): void {
  const sorted = (entries: [string, number][]) =>
    Object.fromEntries(entries.sort(([left], [right]) => byName(left, right)));
  const counted = Object.entries(counts);
  const written: Allowlist = {
    sharedUtilities: sorted(counted.filter(([file]) => file in allowlist.sharedUtilities)),
    files: sorted(counted.filter(([file]) => !(file in allowlist.sharedUtilities))),
  };
  writeFileSync(allowlistPath, `${JSON.stringify(written, null, 2)}\n`);
  run("node_modules/.bin/vp", ["fmt", allowlistPath]);
  console.log(`${allowlistPath}: ${counted.length} files written from the tree.`);
}

function main(): void {
  const allowlist = readAllowlist(readFileSync(allowlistPath, "utf8"));
  const files = trackedSourceFiles();
  const counts = countAssertions(files);

  if (process.argv.includes("--write")) {
    writeAllowlist(allowlist, counts);
    return;
  }

  const problems = ratchetProblems({
    counts,
    allowlist,
    base: readBase(),
    overrides: resolvedLintConfig().overrides,
    disableComments: findAllDisableComments(files),
  });
  if (problems.length === 0) return;

  console.error(
    [`Type assertions (${standards}):`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
  );
  process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) main();
