import { describe, expect, test } from "vite-plus/test";

import { checkLabels, findLabelReferencesInSource } from "./check-labels.ts";
import { parseLabelFile } from "./labels.ts";

const filePath = ".github/workflows/example.yml";

function labelsIn(contents: string): string[] {
  return findLabelReferencesInSource({ contents, filePath }).map((reference) => reference.label);
}

describe("label references", () => {
  test("reads the gh flag forms, quoted, bare and comma-separated", () => {
    expect(
      labelsIn(`gh issue edit "$N" --remove-label "priority:next" --add-label 'priority:parked'`),
    ).toEqual(["priority:next", "priority:parked"]);
    expect(labelsIn(`gh issue create --label needs-triage`)).toEqual(["needs-triage"]);
    expect(labelsIn(`gh issue list --label=bug,chore`)).toEqual(["bug", "chore"]);
  });

  test("reads a flag and its value split across an argv array", () => {
    expect(labelsIn(`gh([\n  "issue",\n  "--label",\n  "needs-triage",\n]);`)).toEqual([
      "needs-triage",
    ]);
  });

  test("reads workflow conditions and jq equality", () => {
    expect(labelsIn(`if: github.event.label.name == 'ready-for-agent'`)).toEqual([
      "ready-for-agent",
    ]);
    expect(labelsIn(`select(startswith("priority:") or . == "bug" or . == "chore")`)).toEqual([
      "bug",
      "chore",
    ]);
  });

  test("reads a prefixed label anywhere, since those names are never prose", () => {
    expect(labelsIn(`const queue = ["priority:next", "wayfinder:map"];`)).toEqual([
      "priority:next",
      "wayfinder:map",
    ]);
  });

  test("reports each reference once, with its line", () => {
    const references = findLabelReferencesInSource({
      contents: `name: x\n  --add-label "priority:later"`,
      filePath,
    });

    expect(references).toEqual([{ filePath, label: "priority:later", lineNumber: 2 }]);
  });

  test("in markdown, reads the code and not the prose around it", () => {
    const markdown = "docs/agents/example.md";
    const read = (contents: string) =>
      findLabelReferencesInSource({ contents, filePath: markdown }).map(
        (reference) => reference.label,
      );

    // A sentence that mentions the flag is not a command: without this the word
    // after it reads as a label and a doc edit fails CI over English.
    expect(read(`Use --label to filter, or pass --label when you need it.`)).toEqual([]);
    expect(read("The queue is `gh issue list --label priority:next`.")).toEqual(["priority:next"]);
    expect(
      read("Then run it:\n\n```bash\ngh issue edit 1 --add-label needs-triage\n```\n"),
    ).toEqual(["needs-triage"]);
    // Two code spans are two commands: the prose between them does not join
    // a flag in one to a word in the next.
    expect(read("Use `--label` to filter a `gh issue list` command.")).toEqual([]);
    // Prose still reports the line the code sits on.
    expect(
      findLabelReferencesInSource({
        contents: "Some prose about labels.\nTriage adds `priority:later` here.",
        filePath: markdown,
      }),
    ).toEqual([{ filePath: markdown, label: "priority:later", lineNumber: 2 }]);
  });

  // Each of these reads like a label to a naive grep and is not one.
  test("ignores variables, placeholders and families", () => {
    expect(labelsIn(`--add-label "$label"`)).toEqual([]);
    expect(labelsIn(`--label wayfinder:<type> ...`)).toEqual([]);
    expect(labelsIn(`the \`priority:*\` labels and \`wayfinder:\``)).toEqual([]);
    expect(labelsIn(`with appropriate \`--label\` filters`)).toEqual([]);
  });
});

describe("label check", () => {
  test("fails a misspelled label", () => {
    const violations = checkLabels({
      files: [
        {
          contents: `--add-label "priority:nxet"\n--add-label "priority:next"`,
          filePath,
        },
      ],
      known: ["priority:next"],
    });

    expect(violations).toEqual([{ filePath, label: "priority:nxet", lineNumber: 1 }]);
  });

  test("passes on this repo: every label the automation uses is in the file", () => {
    expect(checkLabels()).toEqual([]);
  });
});

describe("label file", () => {
  const valid = {
    groups: {
      type: [{ color: "d73a4a", description: "Wrong behaviour", name: "bug" }],
    },
  };

  test("accepts a well-formed file", () => {
    expect(parseLabelFile(valid)).toEqual({
      labels: [{ color: "d73a4a", description: "Wrong behaviour", name: "bug" }],
      problems: [],
    });
  });

  test("rejects a missing description, a bad colour and a repeated name", () => {
    const { problems } = parseLabelFile({
      groups: {
        a: [{ color: "#d73a4a", description: "", name: "bug" }],
        b: [{ color: "d73a4a", description: "Again", name: "bug" }],
      },
    });

    expect(problems).toEqual([
      "bug: colour must be six hex digits without #, got #d73a4a",
      "bug: description is empty",
      "bug: listed more than once",
    ]);
  });

  // The file is read by a script that then calls `gh` with whatever it holds,
  // so a malformed entry has to come back as a problem, not as a crash or as a
  // label named `undefined`.
  test("rejects an entry that is not a label, or has no usable name", () => {
    expect(parseLabelFile({ groups: { a: [null] } })).toEqual({
      labels: [],
      problems: ["entry 1: not a label object, got null"],
    });
    expect(
      parseLabelFile({
        groups: { a: [{ color: "d73a4a", description: "No name" }] },
      }).problems,
    ).toEqual(["entry 1: name must be a word of letters, digits, `-` and `:`, got undefined"]);
  });

  // `check-labels.ts` reads a label as one shell word, so a name holding a
  // space could never be matched against the automation that uses it.
  test("rejects a name the reference scanner could not read back", () => {
    expect(
      parseLabelFile({
        groups: {
          a: [
            {
              color: "7057ff",
              description: "Good for newcomers",
              name: "good first issue",
            },
          ],
        },
      }).problems,
    ).toEqual([
      'entry 1: name must be a word of letters, digits, `-` and `:`, got "good first issue"',
    ]);
  });

  test("rejects a file without groups", () => {
    expect(parseLabelFile({ labels: [] }).problems).toEqual([
      "the file must hold a `groups` object of label arrays",
    ]);
  });
});
