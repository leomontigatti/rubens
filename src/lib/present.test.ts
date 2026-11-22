import { describe, expect, it } from "vite-plus/test";

import { present } from "#/lib/present.ts";

describe("present", () => {
  it("returns a value that is there, falsy ones included", () => {
    expect(present(0, "a count")).toBe(0);
    expect(present("", "a text")).toBe("");
  });

  it("throws the invariant it was given when the value is missing", () => {
    expect(() => present(undefined, "A row just written is found")).toThrow(
      new Error("A row just written is found"),
    );
    expect(() => present(null, "A held conversation has a holder")).toThrow(
      new Error("A held conversation has a holder"),
    );
  });
});
