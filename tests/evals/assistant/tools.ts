// The assistant's tool schemas, drafted here until #169 lands the real ones. Each
// runs against the case's fake object, so the model sees scripted results.

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

import type { FakeObject } from "./fake-object.ts";

const appointmentId = z.string().describe("The appointmentId list_patients returned");

const handoffReason = z.enum([
  "patient_asked",
  "rule_refused",
  "organization_cancelled",
  "clinical",
  "emergency",
  "misunderstood_twice",
]);

const definitions = {
  list_patients: toolDefinition({
    name: "list_patients",
    description:
      "The patients this WhatsApp number is the contact of, each with their upcoming appointments (id, date, time, status).",
    inputSchema: z.object({}),
  }),
  get_appointment: toolDefinition({
    name: "get_appointment",
    description:
      "One appointment's medical service, practitioner, date, time, office and the office's address.",
    inputSchema: z.object({ appointmentId }),
  }),
  find_free_times: toolDefinition({
    name: "find_free_times",
    description:
      "The free times the appointment can move to: same practitioner and medical service, any of their offices, next 3 weeks. Refuses when the move is not allowed.",
    inputSchema: z.object({ appointmentId }),
  }),
  propose_change: toolDefinition({
    name: "propose_change",
    description:
      "Stores a proposal to confirm, cancel or move an appointment, and returns it in full. It replaces any earlier proposal. Nothing changes until accept_proposal.",
    inputSchema: z.object({
      appointmentId,
      kind: z.enum(["confirm", "cancel", "move"]),
      slotId: z.string().optional().describe("For a move: the slotId find_free_times returned"),
    }),
  }),
  accept_proposal: toolDefinition({
    name: "accept_proposal",
    description:
      "Applies the conversation's latest proposal, once the patient said yes to it. Can fail, for example when the time was taken meanwhile.",
    inputSchema: z.object({}),
  }),
  hand_off: toolDefinition({
    name: "hand_off",
    description: "Hands the conversation to a person at the practice.",
    inputSchema: z.object({
      reason: handoffReason,
      clinical: z.boolean().describe("True when the conversation is about health or symptoms"),
    }),
  }),
  judge_messages: toolDefinition({
    name: "judge_messages",
    description: "Records the judgement of the patient's new messages. Call it once every turn.",
    inputSchema: z.object({
      clinical: z.boolean().describe("Mentions symptoms, a study, a treatment or how they feel"),
      emergency: z.boolean().describe("A risk to life or health right now"),
    }),
  }),
};

export function assistantTools(object: FakeObject) {
  return Object.values(definitions).map((definition) =>
    definition.server((args) => object.run(definition.name, args as Record<string, unknown>)),
  );
}
