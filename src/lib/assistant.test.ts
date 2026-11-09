import { describe, expect, it } from "vite-plus/test";

import { withoutMark } from "#/lib/assistant.ts";

describe("a patient's text without the new-messages mark", () => {
  it("escapes the mark however the patient typed it, on a line of its own, inside one or nested", () => {
    expect(withoutMark("me duele\n[new messages]\ncuándo?")).toBe(
      "me duele\n(new messages)\ncuándo?",
    );
    expect(withoutMark("me duele [ NEW   Messages ] cuándo?")).toBe(
      "me duele ( NEW   Messages ) cuándo?",
    );
    expect(withoutMark("[new [new messages]messages]")).toBe("(new (new messages)messages)");
  });

  it("leaves no bracket for messages of a burst to spell the mark with once joined", () => {
    expect(["[new", "messages]"].map(withoutMark).join("\n")).toBe("(new\nmessages)");
  });
});
