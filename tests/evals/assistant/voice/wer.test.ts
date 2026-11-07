import { describe, expect, it } from "vite-plus/test";

import { wordErrorRate } from "./wer.ts";

describe("wordErrorRate", () => {
  it("is zero when only case, accents and punctuation differ", () => {
    expect(wordErrorRate("Mirá, cancelame el turno.", "mira cancelame el TURNO")).toBe(0);
  });

  it("counts substitutions, insertions and deletions over the words spoken", () => {
    // `jueves` → `viernes` (substitution), `nomás` dropped (deletion), `che` added (insertion).
    expect(wordErrorRate("el jueves voy nomás", "che el viernes voy")).toBe(3 / 4);
  });

  it("reads a time in words and in digits alike", () => {
    expect(
      wordErrorRate("el martes diecisiete a las diez y media", "el martes 17 a las 10:30"),
    ).toBe(0);
  });

  it("is one for an empty transcript", () => {
    expect(wordErrorRate("sí, voy", "")).toBe(1);
  });
});
