import { describe, expect, it } from "vite-plus/test";

import { returnPath } from "#/lib/return-path.ts";

describe("returnPath", () => {
  it("keeps a path of this app, with its search and hash", () => {
    expect(returnPath("/agenda?semana=2026-11-02#hoy")).toBe("/agenda?semana=2026-11-02#hoy");
  });

  it("refuses what the browser would resolve to another site", () => {
    expect(returnPath("//evil.example")).toBeUndefined();
    expect(returnPath("/\\evil.example")).toBeUndefined();
    expect(returnPath("https://evil.example/")).toBeUndefined();
    expect(returnPath("evil.example")).toBeUndefined();
  });

  it("refuses a path whose dot segments collapse into another site", () => {
    // Each normalizes to `//evil.example`, which a browser follows to https://evil.example/.
    expect(returnPath("/.//evil.example")).toBeUndefined();
    expect(returnPath("/a/..//evil.example?x#y")).toBeUndefined();
    expect(returnPath("/%2e%2e//evil.example")).toBeUndefined();
  });

  it("refuses a path holding a control or whitespace character the URL parser drops", () => {
    // `/\t/evil.example` resolves to https://evil.example/: the parser drops the tab.
    expect(returnPath("/\t/evil.example")).toBeUndefined();
    expect(returnPath("/\n/evil.example")).toBeUndefined();
    expect(returnPath("/agenda ")).toBeUndefined();
    expect(returnPath("/\u007f")).toBeUndefined();
  });
});
