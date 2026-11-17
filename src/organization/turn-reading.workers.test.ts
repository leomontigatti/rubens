import { describe, expect, it } from "vite-plus/test";

import { longPauseNote, newMessagesMark } from "#/lib/assistant.ts";
import { asTurnMessages, type TurnRead } from "#/organization/turn-reading.ts";

const minuteMs = 60_000;

type Message = TurnRead["history"][number];

function message(id: string, direction: Message["direction"], minute: number, text: string) {
  return {
    id,
    sentAt: minute * minuteMs,
    direction,
    type: "text",
    text,
    reactsTo: null,
    buttonPayload: null,
    repliesTo: null,
    sentBy: null,
  } satisfies Message;
}

/** A conversation as `readConversation` returns it, with no reaction, tap or withdrawn reply. */
function read(history: Message[], unjudged: Message[]): TurnRead {
  return {
    phone: "+5491155550000",
    misunderstandings: 0,
    patients: [],
    unjudged,
    history,
    withdrawn: new Set(),
    reactions: { lines: new Map(), live: new Set() },
    taps: new Map(),
  };
}

// The history and the new messages are read apart (`readConversation`), so a
// message the practice sent can fall between two new ones.
describe("asTurnMessages", () => {
  it("measures a pause from the latest message before it, across the history and the new messages (#393)", () => {
    const messages = asTurnMessages(
      read(
        [message("reminder", "outgoing", 30, "Te recordamos tu turno")],
        [message("first", "incoming", 0, "hola"), message("second", "incoming", 60, "sigo acá")],
      ),
    );

    expect(messages.at(-1)).toEqual({
      role: "user",
      content: `${newMessagesMark}\nhola\nsigo acá`,
    });
  });

  it("marks a pause of an hour or more after the latest message (#393)", () => {
    const messages = asTurnMessages(
      read(
        [message("reminder", "outgoing", 0, "Te recordamos tu turno")],
        [message("answer", "incoming", 60, "lo puedo cambiar?")],
      ),
    );

    expect(messages.at(-1)).toEqual({
      role: "user",
      content: `${newMessagesMark}\n${longPauseNote}\nlo puedo cambiar?`,
    });
  });
});
