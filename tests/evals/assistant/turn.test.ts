import { describe, expect, it } from "vite-plus/test";

import { findCandidate } from "./candidates.ts";
import { costOf } from "./turn.ts";

describe("costOf", () => {
  it("charges cached input at the candidate's cached rate", () => {
    // glm-5.3: 1.4 per million input, 0.26 cached, 4.4 output.
    const cost = costOf(findCandidate("glm-5.3"), {
      input: 1_000_000,
      cachedInput: 600_000,
      output: 100_000,
    });

    expect(cost).toBeCloseTo((400_000 * 1.4 + 600_000 * 0.26 + 100_000 * 4.4) / 1_000_000);
  });

  it("charges cached input at the full rate when the candidate has no cached rate", () => {
    const cost = costOf(findCandidate("gpt-oss-120b"), {
      input: 1_000_000,
      cachedInput: 600_000,
      output: 0,
    });

    expect(cost).toBeCloseTo(0.35);
  });
});
