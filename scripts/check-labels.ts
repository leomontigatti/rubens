import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { labelFilePath, readLabelFile } from "./labels.ts";

// Every label the automation names is in `.github/labels.json`.
//
// Labels are matched as exact strings. A typo in an `--add-label` does not
// fail anything until the command that needs it: GitHub refuses the edit, or a
// filter on the label quietly matches nothing. This check moves that failure
// to CI.
//
// It reads the forms the repo actually uses rather than grepping for every
// name, because `bug` and `chore` are English words all over the prose. A bare
// label string in TypeScript that no form below matches is not seen; keep label
// names in a prefixed family or behind a `--label` flag and it will be. In
// markdown only the code, fenced or backticked, is read, for the reason
// `keepOnlyMarkdownCode` gives. A value is one shell word, so `--label
// "bug, chore"` (a space after the comma, which `gh` does not accept either) is
// read as no label at all rather than as two.

const scanned: { directory: string; keeps: RegExp }[] = [
  { directory: ".github/workflows", keeps: /\.ya?ml$/ },
  { directory: "scripts", keeps: /\.(ts|mts|mjs|sh)$/ },
  // The contract files the shared skills read their label commands from
  // (docs/agents/issue-tracker.md § Labels).
  { directory: "docs/agents", keeps: /\.md$/ },
];

// Fixtures in tests hold misspelled labels on purpose.
const testFilePattern = /\.test\.(ts|mts)$/;

// A label value ends on a letter or digit and is not followed by anything that
// makes it a placeholder (`wayfinder:<type>`), a family (`priority:*`) or longer.
const labelValue = String.raw`[A-Za-z0-9](?:[\w:,-]*[A-Za-z0-9])?(?![\w:<*,-])`;

const referencePatterns: RegExp[] = [
  // `--label needs-triage`, `--add-label "priority:next"`, `--label=bug,chore`,
  // and the argv form a script passes to `gh`, where the flag and its value are
  // separate strings, often on separate lines.
  new RegExp(String.raw`--(?:add-|remove-)?label["']?(?:\s*,\s*|=|\s+)["']?(${labelValue})`, "dg"),
  // Workflow trigger conditions.
  new RegExp(String.raw`label\.name\s*===?\s*["'](${labelValue})["']`, "dg"),
  // jq equality.
  new RegExp(String.raw`(?:^|[\s(])\.\s*==\s*"(${labelValue})"`, "dg"),
  // A prefixed family name is never prose, so it counts wherever it appears.
  new RegExp(String.raw`\b((?:priority|wayfinder):${labelValue})`, "dg"),
];

type LabelReference = {
  filePath: string;
  label: string;
  lineNumber: number;
};

/**
 * Blank everything a markdown file says in prose, keeping its code (fenced
 * blocks and inline spans) where it stands.
 *
 * Prose is not a command line, and the flag patterns above cannot tell the two
 * apart: "pass `--label` when you need it" written without the backticks reads
 * as the label `when`, and CI then fails a doc edit over a word in a sentence.
 * Inside a code span the same text is a command, so the backtick the docs
 * already put around every label name and every `gh` line is the signal. Blanks
 * are one character each, so offsets and line numbers still line up, and they
 * are not whitespace, so a flag at the end of one code span is never read
 * together with the first word of the next.
 */
function keepOnlyMarkdownCode(contents: string): string {
  const blank = (length: number) => "\0".repeat(length);
  let insideFence = false;

  return contents
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        insideFence = !insideFence;
        return blank(line.length);
      }
      if (insideFence) {
        return line;
      }

      let kept = "";
      let index = 0;

      while (index < line.length) {
        const open = line.indexOf("`", index);
        const close = open === -1 ? -1 : line.indexOf("`", open + 1);

        if (close === -1) {
          return kept + blank(line.length - index);
        }
        // The backticks themselves are blanked with the prose around them.
        kept += `${blank(open - index + 1)}${line.slice(open + 1, close)}${blank(1)}`;
        index = close + 1;
      }

      return kept;
    })
    .join("\n");
}

export function findLabelReferencesInSource(input: {
  contents: string;
  filePath: string;
}): LabelReference[] {
  const byOffset = new Map<number, string>();
  const searched = input.filePath.endsWith(".md")
    ? keepOnlyMarkdownCode(input.contents)
    : input.contents;

  for (const pattern of referencePatterns) {
    for (const match of searched.matchAll(pattern)) {
      let offset = match.indices?.[1]?.[0] ?? 0;

      for (const label of (match[1] ?? "").split(",")) {
        if (label) {
          byOffset.set(offset, label);
        }
        offset += label.length + 1;
      }
    }
  }

  return [...byOffset]
    .sort(([a], [b]) => a - b)
    .map(([offset, label]) => ({
      filePath: input.filePath,
      label,
      lineNumber: searched.slice(0, offset).split("\n").length,
    }));
}

function readScannedFiles(rootDirectory: string): { contents: string; filePath: string }[] {
  return scanned.flatMap(({ directory, keeps }) =>
    readdirSync(path.join(rootDirectory, directory), { recursive: true })
      .map(String)
      .filter(
        (relativePath) =>
          !relativePath.split(path.sep).includes("node_modules") &&
          keeps.test(relativePath) &&
          !testFilePattern.test(relativePath),
      )
      .map((relativePath) => {
        const filePath = path.join(directory, relativePath);
        return { contents: readFileSync(path.join(rootDirectory, filePath), "utf8"), filePath };
      }),
  );
}

export function checkLabels(
  options: {
    files?: { contents: string; filePath: string }[];
    known?: string[];
    rootDirectory?: string;
  } = {},
): LabelReference[] {
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const known = new Set(options.known ?? readLabelFile(rootDirectory).map((label) => label.name));
  const files = options.files ?? readScannedFiles(rootDirectory);

  return files
    .flatMap(findLabelReferencesInSource)
    .filter((reference) => !known.has(reference.label));
}

function runLabelsCheck(): void {
  const violations = checkLabels();

  if (violations.length === 0) {
    return;
  }

  throw new Error(
    [
      `Labels referenced but not in ${labelFilePath}:`,
      ...violations.map(
        (violation) => `- ${violation.filePath}:${violation.lineNumber} ${violation.label}`,
      ),
      "",
      `Fix the spelling, or add the label to ${labelFilePath} and run \`pnpm labels:sync\`.`,
    ].join("\n"),
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    runLabelsCheck();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
