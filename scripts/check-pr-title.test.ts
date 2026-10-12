import { describe, expect, test } from "vite-plus/test";

import { checkPrTitle } from "./check-pr-title.ts";

function rulesBrokenBy(title: string): string[] {
  return checkPrTitle({ title }).map((violation) => violation.rule);
}

describe("PR-title gate", () => {
  test("passes a conventional title with an English subject", () => {
    expect(
      rulesBrokenBy("feat(forms): keep views mounted when a submit fails unexpectedly"),
    ).toEqual([]);
  });

  test("passes a breaking change without a scope", () => {
    expect(rulesBrokenBy("refactor!: drop the legacy tenant header")).toEqual([]);
  });

  test("fails a title with no conventional prefix", () => {
    expect(rulesBrokenBy("worktree shadcn upstream sync")).toEqual(["conventional prefix"]);
  });

  test("fails a prefix with no space after the colon", () => {
    expect(rulesBrokenBy("feat:no space here")).toEqual(["conventional prefix"]);
  });

  test("fails a Spanish subject, and checks it even without a prefix", () => {
    expect(rulesBrokenBy("feat(agenda): agregar la vista del calendario")).toEqual([
      "english subject",
    ]);
    expect(rulesBrokenBy("Agregar la vista")).toEqual(["conventional prefix", "english subject"]);
  });

  test("does not check the scope, which is free-form", () => {
    expect(rulesBrokenBy("feat(agenda de clases): show the weekly view")).toEqual([]);
  });

  test("accepts a Spanish term quoted in backticks", () => {
    expect(rulesBrokenBy("fix(seed): keep `para` out of the slug generator")).toEqual([]);
  });
});
