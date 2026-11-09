import { describe, expect, it } from "vite-plus/test";

import { checkReply, maxReplyLength } from "#/lib/reply-checks.ts";

describe("the fixed checks on an assistant reply", () => {
  it("drops the opening question mark and the emoji", () => {
    expect(checkReply("¿Venís mañana? 😊")).toEqual({ ok: true, text: "Venís mañana?" });
  });

  it("drops every opening mark, not only the first", () => {
    expect(checkReply("¡Hola! ¿Te queda bien el martes?")).toEqual({
      ok: true,
      text: "Hola! Te queda bien el martes?",
    });
  });

  it("strips emojis made of several code points and keeps the line breaks", () => {
    expect(checkReply("Listo 👍🏽\nTe esperamos 👨‍⚕️ en la sede 🇦🇷.")).toEqual({
      ok: true,
      text: "Listo\nTe esperamos en la sede.",
    });
  });

  it("strips keycap and subdivision flag emojis whole, keeping plain digits", () => {
    expect(checkReply("Opciones: 1️⃣ martes, 2️⃣ jueves a las 10")).toEqual({
      ok: true,
      text: "Opciones: martes, jueves a las 10",
    });
    // The flag of England: a black flag followed by its invisible tag characters.
    const england = String.fromCodePoint(
      0x1f3f4,
      0xe0067,
      0xe0062,
      0xe0065,
      0xe006e,
      0xe0067,
      0xe007f,
    );
    expect(checkReply(`1️⃣ ${england}`)).toEqual({
      ok: false,
      reason: "empty",
      text: "",
      length: 0,
    });
  });

  it("keeps the words on each side of an emoji apart, and adds no space before a closing mark", () => {
    expect(checkReply("Listo👍Te esperamos")).toEqual({ ok: true, text: "Listo Te esperamos" });
    expect(checkReply("(te esperamos😊) «Hola😊» Gracias👍…")).toEqual({
      ok: true,
      text: "(te esperamos) «Hola» Gracias…",
    });
  });

  it("keeps symbols that are not emojis: ® ™ © and arrows", () => {
    const text = "Clínica Sonrisa® y Dentix™ ©2026: entrada ➡ piso 2.";

    expect(checkReply(text)).toEqual({ ok: true, text });
    expect(checkReply("Te esperamos ❤️")).toEqual({ ok: true, text: "Te esperamos" });
    expect(checkReply("Te esperamos ❤ ✔ listo ☀")).toEqual({
      ok: true,
      text: "Te esperamos listo",
    });
  });

  it("strips a sequence built on a bare pictograph, and keeps a symbol asked to show as text", () => {
    // A heart on fire with no variation selector after the heart.
    expect(checkReply("Hola \u2764\u200D\u{1F525}")).toEqual({ ok: true, text: "Hola" });
    expect(checkReply("Marca\u00AE\uFE0E")).toEqual({ ok: true, text: "Marca®" });
  });

  it("keeps accented letters and plain punctuation", () => {
    const text = "Sí, el turno del miércoles con la Dra. Muñoz sigue en pie: 10:30 h.";

    expect(checkReply(text)).toEqual({ ok: true, text });
  });

  it("flags a reply over the maximum length, after the corrections", () => {
    const long = "a".repeat(maxReplyLength + 1);

    expect(checkReply(long)).toEqual({
      ok: false,
      reason: "tooLong",
      text: long,
      length: maxReplyLength + 1,
    });
    // What the corrections remove does not count.
    expect(checkReply(`¿${"a".repeat(maxReplyLength - 1)}? 😊`)).toEqual({
      ok: true,
      text: `${"a".repeat(maxReplyLength - 1)}?`,
    });
  });

  it("flags a reply the corrections leave empty", () => {
    expect(checkReply(" 😊 ¡ ")).toEqual({ ok: false, reason: "empty", text: "", length: 0 });
  });
});
