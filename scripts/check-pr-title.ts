import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// A PR title is a commit message. PRs here are squash-merged, so the title is
// what lands on `main` as the subject line, and it is the part of a PR's prose
// that outlives the PR.
//
// Two rules. The subject must be a conventional commit, because the history
// obeys that grammar and a title that breaks it reads as a bare sentence in
// `git log`. The subject must also be English: engineering prose is English
// (see the coding standards), and a title is in no file any other check scans.

/**
 * The types the repo's history is expected to use. `style` is deliberately
 * absent: a gate that accepts a type nobody writes would let a typo through
 * under a different name.
 */
export const conventionalTypes = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "perf",
  "test",
  "ci",
  "chore",
  "build",
  "revert",
];

/**
 * `type(scope)!: subject`, with the scope and the breaking-change `!` optional
 * and the subject required to start on a non-space. The separator is exactly
 * `: `, so `feat:no space` is rejected.
 *
 * The subject is the one capture group, so the same grammar that decides where
 * the prefix ends also decides where the subject begins: the two rules cannot
 * disagree about a title.
 */
const conventionalTitlePattern = new RegExp(
  `^(?:${conventionalTypes.join("|")})(?:\\([^)]+\\))?!?: (\\S[\\s\\S]*)`,
);

export type PrTitleViolation = {
  message: string;
  rule: "conventional prefix" | "english subject";
};

const acceptedExample = "feat(forms): keep views mounted when a submit fails unexpectedly";

/**
 * Spanish function words and verbs that do not double as English words in a
 * commit subject. This is a heuristic, not a language detector: it catches a
 * title written in Spanish, which is the mistake this gate exists for, and
 * nothing finer.
 */
const spanishMarkers = [
  "el",
  "los",
  "las",
  "del",
  "que",
  "para",
  "con",
  "una",
  "por",
  "sin",
  "desde",
  "entre",
  "agregar",
  "corregir",
  "arreglar",
  "cambiar",
];

/**
 * The subject with backtick code spans removed: naming a Spanish term in code
 * is still fine, because it is the data it is.
 */
function subjectOf(title: string): string {
  const subject = conventionalTitlePattern.exec(title)?.[1] ?? title;
  return subject.replace(/`[^`]*`/g, " ");
}

function spanishMarkersIn(text: string): string[] {
  const words = text.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
  return [...new Set(words.filter((word) => spanishMarkers.includes(word)))];
}

export function checkPrTitle(input: { title: string }): PrTitleViolation[] {
  const title = input.title.trim();
  const violations: PrTitleViolation[] = [];

  if (!conventionalTitlePattern.test(title)) {
    violations.push({
      message:
        `The PR title is not a conventional commit: "${title}". ` +
        `It is squash-merged into \`main\` as the commit subject, so it needs a \`type(scope): subject\` prefix: ` +
        `one of ${conventionalTypes.join(", ")}, an optional \`(scope)\`, an optional \`!\`, then \`: \` and the subject. ` +
        `Accepted: "${acceptedExample}".`,
      rule: "conventional prefix",
    });
  }

  const markers = spanishMarkersIn(subjectOf(title));

  if (markers.length > 0) {
    violations.push({
      message:
        `The PR title's subject is not English (matched ${markers.join(", ")}): "${title}". ` +
        "Engineering prose is English; the scope is free-form and is not checked. " +
        "Naming a term in backticks is still fine. " +
        `Accepted: "${acceptedExample}".`,
      rule: "english subject",
    });
  }

  return violations;
}

/**
 * Usage: `pnpm check:pr-title "<title>"`, or with `PR_TITLE` set and no
 * argument, which is how a workflow should pass it: interpolating the title
 * into a `run:` block is a template injection a PR author controls.
 */
function runPrTitleGate(): void {
  const title = process.argv[2] ?? process.env.PR_TITLE;
  const errorPrefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";

  if (title === undefined) {
    console.error(
      `${errorPrefix}No PR title given. Pass it as the first argument or set PR_TITLE.`,
    );
    process.exitCode = 1;
    return;
  }

  const violations = checkPrTitle({ title });

  for (const violation of violations) {
    console.error(`${errorPrefix}${violation.rule}: ${violation.message}`);
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  runPrTitleGate();
}
