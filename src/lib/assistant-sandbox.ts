import * as z from "zod";

import { handoffReasons } from "#/lib/handoffs.ts";
import { proposalKinds } from "#/lib/proposals.ts";
import { messageJudgements } from "#/lib/whatsapp-messages.ts";

// The assistant's sandbox in the WhatsApp settings (docs/domain/assistant.md §
// Trying it): an admin plays the patient against the real assistant, from a
// scenario, and the object discards every write. Its conversation lives in the
// page, not in the object: each turn sends it back, and the object replays it
// inside a transaction it rolls back (`src/organization/assistant-sandbox.ts`).

/** The model calls the sandbox may make in an hour, per organization: about fifty turns. */
export const sandboxModelCallsPerHour = 200;

/** The longest message the admin may write as the patient, as WhatsApp allows it. */
const maxSandboxTextLength = 4096;

/** The messages a sandbox conversation holds, the reminder included. */
const maxSandboxMessages = 120;

/** The proposals or handoffs it holds: a turn can make several, so far more than its messages. */
const maxSandboxRecords = 1000;

const instant = z.number().int().nonnegative();
const id = z.string().min(1).max(64);

const sandboxMessageSchema = z.object({
  direction: z.enum(["incoming", "outgoing"]),
  text: z.string().max(maxSandboxTextLength),
  sentAt: instant,
  /** An incoming message's judgement; none until its turn judged it. */
  judgement: z.enum(messageJudgements).nullable(),
});

const sandboxProposalSchema = z.object({
  id,
  appointmentId: id,
  kind: z.enum(proposalKinds),
  statement: z.record(z.string().max(64), z.string().max(400)),
  startsAt: instant.nullable(),
  expiresAt: instant,
  acceptedAt: instant.nullable(),
  createdAt: instant,
});

const sandboxHandoffSchema = z.object({
  reason: z.enum(handoffReasons),
  clinical: z.boolean(),
  appointmentId: id.nullable(),
  heldReply: z.string().max(maxSandboxTextLength).nullable(),
});

/**
 * A sandbox conversation as the page carries it: its scenario's appointment,
 * its messages oldest first, the first the reminder just sent, and what its
 * turns left: the misunderstandings in a row, the proposals and the handoffs.
 */
const sandboxStateSchema = z.object({
  conversationId: z.uuid(),
  appointmentId: id,
  messages: z.array(sandboxMessageSchema).min(1).max(maxSandboxMessages),
  misunderstandings: z.number().int().min(0).max(10),
  proposals: z.array(sandboxProposalSchema).max(maxSandboxRecords),
  handoffs: z.array(sandboxHandoffSchema).max(maxSandboxRecords),
});

export type SandboxState = z.output<typeof sandboxStateSchema>;

/** The messages one turn adds: the patient's, and a reply of up to three. */
const messagesPerTurn = 4;

/** Whether the conversation has no room for another turn, which the admin then starts again. */
export function isFull(state: SandboxState) {
  return state.messages.length + messagesPerTurn > maxSandboxMessages;
}

export const sandboxStartSchema = z.object({ appointmentId: id });

export type SandboxStart = z.input<typeof sandboxStartSchema>;

/** One message the admin writes as the patient, in the conversation so far. */
export const sandboxTurnSchema = z.object({
  state: sandboxStateSchema,
  text: z.string().trim().min(1).max(maxSandboxTextLength),
});

export type SandboxTurnInput = z.input<typeof sandboxTurnSchema>;
