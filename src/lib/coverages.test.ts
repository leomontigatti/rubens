import { describe, expect, it } from "vite-plus/test";

import { coverageInputSchema, coverageLabel } from "#/lib/coverages.ts";

describe("coverageLabel", () => {
  it("names the insurer, with the plan when there is one", () => {
    expect(coverageLabel({ insurerName: "OSDE", plan: "310" })).toBe("OSDE · 310");
    expect(coverageLabel({ insurerName: "Apross", plan: null })).toBe("Apross");
  });
});

describe("coverageInputSchema", () => {
  it("reads an empty plan as none and requires a member number", () => {
    const base = { patientId: crypto.randomUUID(), insurerId: crypto.randomUUID() };

    expect(coverageInputSchema.parse({ ...base, plan: " ", memberNumber: " 123 " })).toEqual({
      ...base,
      plan: null,
      memberNumber: "123",
      primary: false,
    });
    expect(coverageInputSchema.safeParse({ ...base, memberNumber: "" }).success).toBe(false);
  });
});
