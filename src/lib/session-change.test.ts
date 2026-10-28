import { describe, expect, it } from "vite-plus/test";

import { loadedBeforeSessionChange } from "#/lib/session-change.ts";

describe("loadedBeforeSessionChange", () => {
  it("is true for a page loaded before the last sign-in or sign-out", () => {
    expect(loadedBeforeSessionChange("2000", 1000)).toBe(true);
  });

  it("is false for the page the sign-in or sign-out loaded", () => {
    expect(loadedBeforeSessionChange("1000", 2000)).toBe(false);
  });

  it("is false when no session change was ever recorded", () => {
    expect(loadedBeforeSessionChange(null, 2000)).toBe(false);
  });
});
