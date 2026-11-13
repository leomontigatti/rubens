import { describe, expect, it } from "vite-plus/test";

import { newMessagesMark } from "../../../src/lib/assistant.ts";

import { findCandidate } from "./candidates.ts";
import { findCase } from "./cases.ts";
import { costOf, turnMessages } from "./turn.ts";

// The turn the model reads must be the one underthing sends it
// (`asTurnMessages`, `src/organization/assistant.ts`): without the mark, the
// prompt's "the patient's new messages, which follow the line" points at nothing.
describe("turnMessages", () => {
  it("puts the patient's new messages after the mark, as the last message", () => {
    const messages = turnMessages(findCase("confirm-and-knee"), ["uno", "dos"]);

    expect(messages.at(-1)).toEqual({ role: "user", content: `${newMessagesMark}\nuno\ndos` });
    expect(messages.slice(0, -1).map((message) => message.role)).toEqual(["assistant"]);
  });

  it("joins a run of one side's messages into one, as WhatsApp shows a burst", () => {
    const messages = turnMessages(
      {
        ...findCase("when"),
        history: [
          { role: "patient", text: "hola" },
          { role: "patient", text: "una consulta" },
          { role: "assistant", text: "Decime" },
        ],
      },
      ["a qué hora era?"],
    );

    expect(messages.map((message) => message.content)).toEqual([
      "hola\nuna consulta",
      "Decime",
      `${newMessagesMark}\na qué hora era?`,
    ]);
  });
});

describe("costOf", () => {
  it("charges cached input at the candidate's cached rate", () => {
    // glm-5.3: 1.4 per million input, 0.26 cached, 4.4 output.
    const cost = costOf(findCandidate("glm-5.3"), {
      input: 1_000_000,
      cachedInput: 600_000,
      output: 100_000,
    });

    expect(cost).toBeCloseTo((400_000 * 1.4 + 600_000 * 0.26 + 100_000 * 4.4) / 1_000_000);
  });

  it("charges cached input at the full rate when the candidate has no cached rate", () => {
    const cost = costOf(findCandidate("gpt-oss-120b"), {
      input: 1_000_000,
      cachedInput: 600_000,
      output: 0,
    });

    expect(cost).toBeCloseTo(0.35);
  });
});
