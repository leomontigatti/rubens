import { describe, expect, it } from "vite-plus/test";

import { splitReply, typingPauseOf } from "#/lib/reply-pacing.ts";

describe("splitting a reply into messages", () => {
  it("sends each paragraph as its own message", () => {
    expect(splitReply("Hola Martina.\n\nTu turno es el lunes a las 9.", { whole: false })).toEqual([
      "Hola Martina.",
      "Tu turno es el lunes a las 9.",
    ]);
  });

  it("sends a reply of four paragraphs as three messages, the last two together", () => {
    const reply = "Uno.\n\nDos.\n\nTres.\n\nCuatro.";

    expect(splitReply(reply, { whole: false })).toEqual(["Uno.", "Dos.", "Tres.\n\nCuatro."]);
  });

  it("keeps a paragraph's lines together", () => {
    const reply = "Hola.\n\nTu turno es el lunes.\nTe esperamos.\nHasta pronto.";

    expect(splitReply(reply, { whole: false })).toEqual([
      "Hola.",
      "Tu turno es el lunes.\nTe esperamos.\nHasta pronto.",
    ]);
  });

  it("ignores the blank lines around and between paragraphs", () => {
    expect(splitReply("\n\nUno.\n \n\n\nDos.\n\n", { whole: false })).toEqual(["Uno.", "Dos."]);
  });

  it("keeps a reply whole when it holds a proposal", () => {
    const reply = "Te propongo pasarlo al martes 10:30 con Juan.\n\nMe confirmás?";

    expect(splitReply(reply, { whole: true })).toEqual([reply]);
  });
});

describe("how long the assistant types a message", () => {
  it("types a longer message for longer, between a short pause and a few seconds", () => {
    const pauses = ["Sí.", "x".repeat(60), "x".repeat(120), "x".repeat(600)].map(typingPauseOf);

    expect(pauses).toEqual([1_575, 3_000, 4_500, 6_000]);
  });
});
