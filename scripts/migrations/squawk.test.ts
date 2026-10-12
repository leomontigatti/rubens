import { describe, expect, it } from "vite-plus/test";

import {
  blockingRules,
  classifySquawkFindings,
  excludedRules,
  formatSquawkFinding,
} from "./squawk.mjs";

function finding(ruleName: string, overrides: Record<string, unknown> = {}) {
  return {
    file: "/repo/src/db/migrations/0023_new.sql",
    line: 0,
    column: 0,
    level: "Warning",
    message: "Something about the statement.",
    help: null,
    rule_name: ruleName,
    ...overrides,
  };
}

describe("classifySquawkFindings", () => {
  it("blocks what breaks the container still serving the old code", () => {
    const findings = [
      finding("ban-drop-column"),
      finding("ban-drop-table"),
      finding("renaming-column"),
      finding("renaming-table"),
      finding("identifier-too-long"),
    ];

    expect(classifySquawkFindings(findings)).toEqual({
      blocking: findings,
      warnings: [],
    });
  });

  it("warns on lock hazards, which only matter once tables grow", () => {
    const findings = [
      finding("adding-foreign-key-constraint"),
      finding("constraint-missing-not-valid"),
      finding("adding-not-nullable-field"),
      finding("disallowed-unique-constraint"),
      finding("ban-drop-not-null"),
    ];

    expect(classifySquawkFindings(findings)).toEqual({
      blocking: [],
      warnings: findings,
    });
  });

  it("warns on a rule a later squawk release adds, rather than blocking it", () => {
    const unknown = finding("some-rule-invented-upstream");

    expect(classifySquawkFindings([unknown])).toEqual({
      blocking: [],
      warnings: [unknown],
    });
  });

  it("classifies nothing when squawk reported nothing", () => {
    expect(classifySquawkFindings([])).toEqual({ blocking: [], warnings: [] });
  });

  it("never blocks on a rule that is excluded from the run", () => {
    for (const rule of excludedRules) {
      expect(blockingRules).not.toContain(rule);
    }
  });
});

describe("formatSquawkFinding", () => {
  it("reports the line one-based, since squawk counts from zero", () => {
    expect(formatSquawkFinding(finding("ban-drop-column", { line: 4 }), (path) => path)).toBe(
      "/repo/src/db/migrations/0023_new.sql:5 " +
        "[ban-drop-column] Something about the statement.",
    );
  });

  it("appends squawk's help when there is one, and shortens the path", () => {
    expect(
      formatSquawkFinding(
        finding("constraint-missing-not-valid", {
          help: "Use `NOT VALID` with a later `VALIDATE CONSTRAINT` call.",
        }),
        () => "src/db/migrations/0023_new.sql",
      ),
    ).toBe(
      "src/db/migrations/0023_new.sql:1 [constraint-missing-not-valid] " +
        "Something about the statement. " +
        "Use `NOT VALID` with a later `VALIDATE CONSTRAINT` call.",
    );
  });
});
