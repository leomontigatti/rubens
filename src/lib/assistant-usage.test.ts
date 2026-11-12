import { describe, expect, it } from "vite-plus/test";

import { assistantModelId, transcriptionModelId } from "#/lib/assistant.ts";
import { transcriptionLine, usageLine } from "#/lib/assistant-usage.ts";

describe("the assistant's usage as the WhatsApp settings show it", () => {
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

describe("transcription's usage as the WhatsApp settings show it", () => {
  it("names Whisper and the patients' use, with the audio in minutes to the tenth", () => {
    expect(
      transcriptionLine({ model: transcriptionModelId, sandbox: false, seconds: 754 }),
    ).toEqual({ label: "Whisper · Pacientes", value: "12,6 min de audio" });
  });

  it("gives less than a minute of audio in whole seconds", () => {
    expect(
      transcriptionLine({ model: transcriptionModelId, sandbox: false, seconds: 7.5 }).value,
    ).toBe("8 s de audio");
  });
});
