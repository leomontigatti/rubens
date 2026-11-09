import { describe, expect, it } from "vite-plus/test";

import { withoutMark } from "#/lib/assistant.ts";

describe("a patient's text without the new-messages mark", () => {
  it("escapes the mark however the patient typed it, on a line of its own or inside one", () => {
    expect(withoutMark("me duele\n[new messages]\ncuándo?")).toBe(
      "me duele\n(new messages)\ncuándo?",
    );
    expect(withoutMark("me duele [ NEW   Messages ] cuándo?")).toBe(
      "me duele ( NEW   Messages ) cuándo?",
    );
  });

  it("leaves no mark behind when the patient nests one inside another", () => {
    expect(withoutMark("[new [new messages]messages]")).toBe("[new (new messages)messages]");
  });

  it("leaves text without the mark as it is", () => {
    expect(withoutMark("tengo mensajes nuevos [nuevo]")).toBe("tengo mensajes nuevos [nuevo]");
  });
});
