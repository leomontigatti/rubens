import { describe, expect, it } from "vite-plus/test";

import { lintProbes } from "./lint.test-support.ts";

// A type assertion is banned (`typescript/consistent-type-assertions` in
// vite.config.ts). Its override, the files the ratchet still allows, is checked
// against scripts/type-assertion-allowlist.json by scripts/check-type-assertions.ts.

const probes = lintProbes("type-assertions");

const assertions = (...files: string[]) =>
  probes.lint(...files).filter((d) => d.code === "typescript(consistent-type-assertions)");

describe("the type assertion ban", { timeout: 30_000 }, () => {
  const casts = probes.probe(
    "casts.ts",
    `declare const value: unknown;

export const asType = value as string;
export const angled = <number>value;
export const twice = value as unknown as { id: string };
`,
  );

  it("rejects an assertion in either syntax, and each half of a double cast", () => {
    expect(assertions(casts)).toHaveLength(4);
  });

  const constant = probes.probe(
    "constant.ts",
    `export const kinds = ["image", "audio"] as const;\n`,
  );

  it("accepts as const, which narrows without overriding the checker", () => {
    expect(assertions(constant)).toEqual([]);
  });
});
