import { describe, expect, it } from "vite-plus/test";

import { initialsOf } from "#/lib/initials.ts";

describe("initialsOf", () => {
  it("takes the first letter of the first two words, capitalized", () => {
    expect(initialsOf("Sede prueba")).toBe("SP");
    expect(initialsOf("Consultorio Central Norte")).toBe("CC");
  });

  it("takes one letter from a one-word name, and ignores extra spaces", () => {
    expect(initialsOf("  centro ")).toBe("C");
  });
});
