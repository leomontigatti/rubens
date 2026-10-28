import { describe, expect, it } from "vite-plus/test";

import { isSignedInAs } from "#/lib/session-change.ts";

describe("isSignedInAs", () => {
  it("is true only when the user the page was loaded for is still signed in", () => {
    expect(isSignedInAs({ ok: true, viewer: { userId: "ana" } }, "ana")).toBe(true);
    expect(isSignedInAs({ ok: true, viewer: { userId: "juan" } }, "ana")).toBe(false);
    expect(isSignedInAs({ ok: false }, "ana")).toBe(false);
  });
});
