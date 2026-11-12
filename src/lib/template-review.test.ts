import { describe, expect, it } from "vite-plus/test";

import { templateReviewPrompt } from "#/lib/template-review.ts";

describe("the template review's instructions", () => {
  it("hold the organization's Trato, and its Tono only when it set one", () => {
    const usted = templateReviewPrompt({ formOfAddress: "usted", tone: "Cordial y breve." });
    expect(usted).toContain('addressed as "usted"');
    expect(usted).toContain("its tone as: Cordial y breve.");

    expect(templateReviewPrompt({ formOfAddress: "vos", tone: "" })).not.toContain("its tone");
  });
});
