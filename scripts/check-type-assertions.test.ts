import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vite-plus/test";

import {
  countAssertions,
  findDisableComments,
  ratchetProblems,
  ruleName,
} from "./check-type-assertions.ts";
import type { Allowlist, RatchetInput } from "./check-type-assertions.ts";

const allowlist: Allowlist = {
  sharedUtilities: { "src/dev/accepted.ts": 1 },
  files: { "src/a.ts": 2, "src/b.ts": 1 },
};

const exempting = (files: string[]) => ({ files, rules: { [ruleName]: "allow" } });

// A tree that matches its allowlist, main's list and the lint override.
const matching: RatchetInput = {
  counts: { "src/a.ts": 2, "src/b.ts": 1, "src/dev/accepted.ts": 1 },
  allowlist,
  base: { state: "read", allowlist },
  overrides: [
    { files: ["scripts/**"], rules: { "no-restricted-globals": "allow" } },
    exempting(["src/dev/accepted.ts"]),
    exempting(["src/a.ts", "src/b.ts"]),
  ],
  disableComments: [],
};

const problems = (change: Partial<RatchetInput>) => ratchetProblems({ ...matching, ...change });

// Built in parts, so this file holds no disable comment the check would find.
const disable = (kind: string) => `// ${["oxlint", kind].join("-")}`;

describe("the type assertion ratchet", () => {
  test("passes a tree whose counts, base and override all match the allowlist", () => {
    expect(problems({})).toEqual([]);
  });

  test("fails a file with more assertions than its entry, naming both counts", () => {
    const found = problems({ counts: { ...matching.counts, "src/a.ts": 3, "src/c.ts": 1 } });

    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/src\/a\.ts.*3.*2/);
    expect(found[1]).toMatch(/src\/c\.ts.*1.*0/);
  });

  test("fails a file with fewer assertions than its entry, and says how to lower it", () => {
    const found = problems({ counts: { "src/a.ts": 1, "src/dev/accepted.ts": 1 } });

    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/src\/a\.ts.*1.*2/);
    expect(found[1]).toMatch(/src\/b\.ts.*0.*1/);
    expect(found.every((problem) => problem.includes("--write"))).toBe(true);
  });

  test("holds a shared utility to its count like any other file", () => {
    const found = problems({ counts: { ...matching.counts, "src/dev/accepted.ts": 2 } });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/src\/dev\/accepted\.ts.*2.*1/);
  });

  test("fails an entry that main's list does not hold, or holds lower", () => {
    const grown: Allowlist = {
      ...allowlist,
      files: { "src/a.ts": 3, "src/b.ts": 1, "src/c.ts": 1 },
    };
    const found = problems({
      allowlist: grown,
      counts: { ...grown.files, "src/dev/accepted.ts": 1 },
      overrides: [exempting(["src/dev/accepted.ts"]), exempting(Object.keys(grown.files))],
    });

    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/src\/a\.ts.*3.*origin\/main.*2/);
    expect(found[1]).toMatch(/src\/c\.ts.*origin\/main/);
  });

  test("fails a shared utility that main's list does not hold", () => {
    const grown: Allowlist = {
      ...allowlist,
      sharedUtilities: { "src/dev/accepted.ts": 1, "src/lib/cast.ts": 5 },
    };
    const found = problems({
      allowlist: grown,
      counts: { ...matching.counts, "src/lib/cast.ts": 5 },
      overrides: [exempting(["src/dev/accepted.ts", "src/lib/cast.ts", "src/a.ts", "src/b.ts"])],
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/src\/lib\/cast\.ts.*origin\/main/);
  });

  test("lets a file move between the lists without rising", () => {
    const moved: Allowlist = {
      sharedUtilities: { ...allowlist.sharedUtilities, "src/b.ts": 1 },
      files: { "src/a.ts": 2 },
    };

    expect(problems({ allowlist: moved })).toEqual([]);
  });

  test("fails closed when main's list cannot be read, and says how to fetch it", () => {
    const found = problems({ base: { state: "unreadable", detail: "unknown revision" } });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("git fetch origin main");
  });

  test("starts the ratchet when main has no list yet", () => {
    expect(problems({ base: { state: "absent" } })).toEqual([]);
  });

  test("fails an override that turns the rule off for a file the lists do not hold", () => {
    const found = problems({
      overrides: [
        ...matching.overrides,
        exempting(["src/c.ts"]),
        { files: ["tests/**"], rules: { [ruleName]: "warn" } },
      ],
    });

    expect(found).toHaveLength(2);
    expect(found[0]).toContain("src/c.ts");
    expect(found[1]).toContain("tests/**");
  });

  test("fails an allowlisted file the override does not exempt", () => {
    const found = problems({ overrides: [exempting(["src/dev/accepted.ts", "src/a.ts"])] });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("src/b.ts");
  });

  test("fails a disable comment, at its file and line", () => {
    const found = problems({ disableComments: [{ file: "src/a.ts", line: 12 }] });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("src/a.ts:12");
  });
});

// Half a statement: neither oxlint nor oxc's parser can read it.
const unparseable = "const a = 1 as number;\nconst b = {\n";

describe("the count", { timeout: 30_000 }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "type-assertion-count-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const file = (relative: string, source: string) => {
    const at = path.join(root, relative);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, source);
    return at;
  };

  test("refuses a file it cannot parse, rather than counting it as none", () => {
    const broken = file("broken.ts", unparseable);

    expect(() => countAssertions([broken])).toThrow(/broken\.ts.*cannot parse/);
  });

  test("counts an assertion that a nested lint config turns off", () => {
    file("nested/.oxlintrc.json", JSON.stringify({ rules: { [ruleName]: "off" } }));
    const hidden = file("nested/hidden.ts", "export const c = 1 as number;\n");

    expect(countAssertions([hidden])).toEqual({ [hidden]: 1 });
  });
});

describe("disable comments", () => {
  test("refuses a file it cannot parse, rather than finding none", () => {
    expect(() => findDisableComments(unparseable, "src/broken.ts")).toThrow(
      /src\/broken\.ts.*cannot parse/,
    );
  });

  test("finds one that names the rule, in any form, and one that names no rule", () => {
    const source = [
      `${disable("disable-next-line")} ${ruleName} -- a reason`,
      "const a = 1;",
      `/* ${["eslint", "disable"].join("-")} @typescript-eslint/consistent-type-assertions */`,
      `${disable("disable-line")}`,
      `/* ${["eslint", "disable"].join("-")} */`,
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([1, 3, 4, 5]);
  });

  test("finds a block comment that names the rule on a later line", () => {
    const source = [
      "const a = 1;",
      `/* ${["eslint", "disable"].join("-")} no-debugger,`,
      `   ${ruleName} */`,
      "const b = 2;",
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([2]);
  });

  test("passes a block comment that names only other rules over several lines", () => {
    const source = [
      `/* ${["eslint", "disable"].join("-")} no-debugger,`,
      "   no-console */",
      `const rule = "${ruleName}";`,
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([]);
  });

  test("reads a line comment after a glob as its own line, not a block comment", () => {
    const source = [
      `const glob = "scripts/**"; ${["// eslint", "disable-next-line"].join("-")}`,
      "const a = 1;",
      `const glob2 = "scripts/**"; ${["// eslint", "disable-line"].join("-")} no-debugger`,
      `const rule = "${ruleName}";`,
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([1]);
  });

  test("finds a directive that starts on the line after its block comment opens", () => {
    const source = [
      "/*",
      `   ${["eslint", "disable"].join("-")} no-debugger,`,
      `   ${ruleName}`,
      " */",
      "const a = 1;",
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([2]);
  });

  test("reads a block comment's rules only up to its end, not the code after it", () => {
    const source = `/* ${["eslint", "disable"].join("-")} no-debugger */ const rule = "${ruleName}";`;

    expect(findDisableComments(source, "probe.ts")).toEqual([]);
  });

  test("finds a directive inside a template literal's expression", () => {
    const source = [
      "export const x = `${",
      `${["// eslint", "disable-next-line"].join("-")} ${ruleName}`,
      "(value as string)",
      "}`;",
    ].join("\n");

    expect(findDisableComments(source, "probe.ts")).toEqual([2]);
  });

  test("finds a directive in JSX after an apostrophe in the text", () => {
    const source = `export const x = <div>Don't {/* ${["eslint", "disable"].join("-")} ${ruleName} */}{value as string}</div>;`;

    expect(findDisableComments(source, "probe.tsx")).toEqual([1]);
  });

  test("passes one that names only other rules", () => {
    expect(
      findDisableComments(
        `${disable("disable-next-line")} jsx-a11y/media-has-caption -- why`,
        "probe.ts",
      ),
    ).toEqual([]);
  });
});
