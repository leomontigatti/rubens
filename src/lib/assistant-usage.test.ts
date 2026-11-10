import { describe, expect, it } from "vite-plus/test";

import { assistantModelId } from "#/lib/assistant.ts";
import { usageLine, usageMonthName } from "#/lib/assistant-usage.ts";

describe("the assistant's usage as the WhatsApp settings show it", () => {
  it("names the month in Spanish", () => {
    expect(usageMonthName("2098-12")).toBe("diciembre de 2098");
    expect(usageMonthName("2099-01")).toBe("enero de 2099");
  });

  it("names the assistant's model and the patients' or the sandbox's use, with grouped tokens", () => {
    const used = { model: assistantModelId, inputTokens: 45_350, outputTokens: 1_630 };

    expect(usageLine({ ...used, sandbox: false })).toEqual({
      label: "Claude Haiku 5.5 · Pacientes",
      value: "45.350 de entrada · 1.630 de salida",
    });
    expect(usageLine({ ...used, sandbox: true }).label).toBe("Claude Haiku 5.5 · Prueba");
  });

  it("shows another model by its id", () => {
    expect(
      usageLine({ model: "other-model", sandbox: false, inputTokens: 0, outputTokens: 0 }).label,
    ).toBe("other-model · Pacientes");
  });
});
