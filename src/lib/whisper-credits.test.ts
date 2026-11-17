import { describe, expect, it } from "vite-plus/test";

import { withoutWhisperCredits } from "#/lib/whisper-credits.ts";

describe("a voice note's transcript, without Whisper's credit lines", () => {
  it("is empty when the transcript is only credit lines", () => {
    for (const credits of [
      "Subtítulos realizados por la comunidad de Amara.org",
      " subtitulos por la comunidad de amara.org ",
      "Subtítulos hechos por la comunidad de Amara.org.",
      "¡Gracias por ver el video!",
      "Gracias por ver el vídeo. Suscríbete al canal.",
      "SUSCRÍBETE AL CANAL",
      "amara.org",
      "Gracias por ver el vídeo\nSuscríbete al canal",
      "Gracias por ver el vídeo, suscríbete al canal",
      "Subtitulado por la comunidad de Amara.org",
    ]) {
      expect(withoutWhisperCredits(credits), credits).toBe("");
    }
  });

  it("keeps the patient's words around the Amara line, with or without punctuation", () => {
    expect(
      withoutWhisperCredits(
        "Tengo fiebre y me cuesta respirar Subtítulos realizados por la comunidad de Amara.org",
      ),
    ).toBe("Tengo fiebre y me cuesta respirar");
    expect(
      withoutWhisperCredits(
        "Subtítulos realizados por la comunidad de Amara.org. Quería saber a qué hora es mi turno.",
      ),
    ).toBe("Quería saber a qué hora es mi turno.");
  });

  it("keeps words that only mention a credit's words in passing", () => {
    for (const words of [
      "Gracias por ver mi consulta tan rápido",
      "me suscribí al canal de la clínica, cuándo es mi turno",
      "tienen subtítulos los videos de los ejercicios?",
      "Necesito subtítulos por mi problema de audición",
      "Gracias por ver el video de mi rodilla, necesito otro turno?",
      "Gracias por ver el video, necesito otro turno",
    ]) {
      expect(withoutWhisperCredits(words), words).toBe(words);
    }
  });

  it("trims the transcript", () => {
    expect(withoutWhisperCredits("  a qué hora es mi turno \n")).toBe("a qué hora es mi turno");
  });
});
