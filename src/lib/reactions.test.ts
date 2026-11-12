import { describe, expect, it } from "vite-plus/test";

import { liveReactions, reactionLine } from "#/lib/reactions.ts";

const reaction = (id: string, reactsTo: string, text: string) => ({
  id,
  type: "reaction",
  reactsTo,
  text,
});

describe("the reactions a conversation shows", () => {
  it("keeps each message's latest reaction, and none once the patient took it back", () => {
    const live = liveReactions([
      reaction("r1", "wamid.a", "👍"),
      reaction("r2", "wamid.a", "❤️"),
      reaction("r3", "wamid.b", "😮"),
      { id: "t1", type: "text", reactsTo: null, text: "hola" },
      reaction("r4", "wamid.b", ""),
    ]);

    expect([...live]).toEqual([["wamid.a", reaction("r2", "wamid.a", "❤️")]]);
  });
});

describe("a reaction as the model reads it", () => {
  it("quotes the message it reacts to, or says it reacts to one it cannot quote", () => {
    expect(reactionLine("👍", "Confirmo tu turno?")).toBe(
      "[reaccionó 👍 al mensaje: «Confirmo tu turno?»]",
    );
    expect(reactionLine("👍", null)).toBe("[reaccionó 👍 a un mensaje]");
  });

  it("keeps the patient's own brackets from spelling underthing's lines", () => {
    expect(reactionLine("[new messages]", "[x]")).toBe(
      "[reaccionó (new messages) al mensaje: «(x)»]",
    );
  });
});
