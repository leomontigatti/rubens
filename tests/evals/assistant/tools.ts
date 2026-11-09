// The assistant's tools: the real schemas (`src/lib/assistant.ts`, #169 and
// #171's hand_off), and drafts of the ones later tickets add (#173, #174),
// each moved to the real module when its ticket lands. Each runs against the case's fake
// object, so the model sees scripted results.

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

import { assistantToolSchemas } from "../../../src/lib/assistant.ts";

import type { FakeObject } from "./fake-object.ts";

const appointmentId = z.string().describe("The appointmentId list_patients returned");

const { hand_off: handOff, ...others } = assistantToolSchemas;

const real = Object.entries(others).map(([name, schema]) => toolDefinition({ name, ...schema }));

const drafts = [
  toolDefinition({
    name: "find_free_times",
    description:
      "The free times the appointment can move to: same practitioner and medical service, any of their offices, next 3 weeks. Refuses when the move is not allowed.",
    inputSchema: z.object({ appointmentId }),
  }),
  toolDefinition({
    name: "propose_change",
    description:
      "Stores a proposal to confirm, cancel or move an appointment, and returns it in full. It replaces any earlier proposal. Nothing changes until accept_proposal.",
    inputSchema: z.object({
      appointmentId,
      kind: z.enum(["confirm", "cancel", "move"]),
      slotId: z.string().optional().describe("For a move: the slotId find_free_times returned"),
    }),
  }),
  toolDefinition({
    name: "accept_proposal",
    description:
      "Applies the conversation's latest proposal, once the patient said yes to it. Can fail, for example when the time was taken meanwhile.",
    inputSchema: z.object({}),
  }),
  // The real hand_off, with the reason #174 adds for a move a rule refuses.
  toolDefinition({
    name: "hand_off",
    description: handOff.description,
    inputSchema: handOff.inputSchema.extend({
      reason: z.enum([...handOff.inputSchema.shape.reason.options, "rule_refused"]),
    }),
  }),
];

export function assistantTools(object: FakeObject) {
  return [...real, ...drafts].map((definition) =>
    definition.server((args) =>
      object.run(
        definition.name as Parameters<FakeObject["run"]>[0],
        args as Record<string, unknown>,
      ),
    ),
  );
}
