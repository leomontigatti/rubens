import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// The repo's labels as code.
//
// `.github/labels.json` is the one list of the labels this repo uses. The
// sync script pushes it to GitHub and the check holds the automation to it, so
// the file, the repo and the workflows cannot drift apart silently. The
// meaning of each label stays in docs/agents/issue-tracker.md (§ Labels); the
// file only says which labels exist.

export const labelFilePath = ".github/labels.json";

export type Label = {
  color: string;
  description: string;
  name: string;
};

const colourPattern = /^[0-9a-f]{6}$/i;

// A name the reference scanner can read back. `check-labels.ts` reads a label
// out of a `--label` flag or a prefixed family, and both stop at whitespace, so
// a name holding a space would sit in this file and never be matched against
// anything: the check would pass while the label went unguarded.
const namePattern = /^[A-Za-z0-9][\w:-]*$/;

/**
 * Validate the file's shape. Groups only organise the file; the result is flat.
 */
export function parseLabelFile(json: unknown): {
  labels: Label[];
  problems: string[];
} {
  const groups = (json as { groups?: unknown } | null)?.groups;

  if (
    typeof groups !== "object" ||
    groups === null ||
    !Object.values(groups).every(Array.isArray)
  ) {
    return {
      labels: [],
      problems: ["the file must hold a `groups` object of label arrays"],
    };
  }

  const entries = Object.values(groups as Record<string, unknown[]>).flat();
  const labels: Label[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    // An entry that is not an object, or whose name is unusable, is reported
    // and dropped: everything below names the label it is about.
    const label = entry as Partial<Label> | null;
    const position = `entry ${index + 1}`;

    if (typeof label !== "object" || label === null) {
      problems.push(`${position}: not a label object, got ${String(entry)}`);
      return;
    }
    if (typeof label.name !== "string" || !namePattern.test(label.name)) {
      problems.push(
        `${position}: name must be a word of letters, digits, \`-\` and \`:\`, got ${JSON.stringify(label.name)}`,
      );
      return;
    }

    if (!colourPattern.test(label.color ?? "")) {
      problems.push(`${label.name}: colour must be six hex digits without #, got ${label.color}`);
    }
    if (!label.description?.trim()) {
      problems.push(`${label.name}: description is empty`);
    }
    if (seen.has(label.name)) {
      problems.push(`${label.name}: listed more than once`);
    }
    seen.add(label.name);

    labels.push(label as Label);
  });

  return { labels, problems };
}

export function readLabelFile(rootDirectory = process.cwd()): Label[] {
  const { labels, problems } = parseLabelFile(
    JSON.parse(readFileSync(path.join(rootDirectory, labelFilePath), "utf8")) as unknown,
  );

  if (problems.length > 0) {
    throw new Error([`${labelFilePath} is invalid:`, ...problems.map((p) => `- ${p}`)].join("\n"));
  }

  return labels;
}
