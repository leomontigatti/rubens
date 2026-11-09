import type * as z from "zod";

import type { assistantToolSchemas } from "#/lib/assistant.ts";
import { windowClosesAt } from "#/lib/conversation-window.ts";

// Proposals (ui: "Propuesta", docs/domain/assistant.md § Proposals): a change
// the assistant states in full and the patient accepts before it is made.
// Only a conversation's latest proposal can be accepted, until it expires.

/** What a proposal changes: confirming the appointment, or cancelling it by the patient. */
export type ProposalKind = z.output<typeof assistantToolSchemas.propose_change.inputSchema>["kind"];

/** The kinds as the proposal table stores them: those the model's tool proposes. */
export const proposalKinds = ["confirm", "cancel"] as const satisfies readonly ProposalKind[];

/** How long a proposal stays open to its yes (#151's defaults). */
const proposalLifetimeMs = 60 * 60_000;

/**
 * When a proposal made at `now` expires: an hour later, or when the window
 * the patient's last message opened closes, whichever comes first.
 */
export function proposalExpiresAt(now: number, lastIncomingAt: number | null): number {
  const closesAt = windowClosesAt(lastIncomingAt) ?? now;
  return Math.min(now + proposalLifetimeMs, closesAt);
}
