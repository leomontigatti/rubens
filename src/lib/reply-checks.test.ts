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
