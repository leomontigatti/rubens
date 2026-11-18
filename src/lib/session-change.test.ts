import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isSignedInAs, startNewSession } from "#/lib/session-change.ts";

describe("isSignedInAs", () => {
  it("is true only when the user the page was loaded for is still signed in", () => {
    expect(isSignedInAs({ ok: true, viewer: { userId: "ana" } }, "ana")).toBe(true);
    expect(isSignedInAs({ ok: true, viewer: { userId: "juan" } }, "ana")).toBe(false);
    expect(isSignedInAs({ ok: false }, "ana")).toBe(false);
  });
});

describe("startNewSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still leaves the previous user's screen when storage is blocked", () => {
    const assign = vi.fn();
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    vi.stubGlobal("window", { location: { assign } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    startNewSession("/agenda");

    expect(assign).toHaveBeenCalledWith("/agenda");
  });
});
