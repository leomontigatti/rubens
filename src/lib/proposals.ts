import type * as z from "zod";

import type { assistantToolSchemas } from "#/lib/assistant.ts";
import { windowClosesAt } from "#/lib/conversation-window.ts";

// Proposals (ui: "Propuesta", docs/domain/assistant.md § Proposals).

/** What a proposal changes: confirming the appointment, cancelling it by the patient, or moving it. */
export type ProposalKind = z.output<typeof assistantToolSchemas.propose_change.inputSchema>["kind"];

export const proposalKinds = [
  "confirm",
  "cancel",
  "move",
] as const satisfies readonly ProposalKind[];

const proposalLifetimeMs = 60 * 60_000;

export function proposalExpiresAt(now: number, lastIncomingAt: number | null): number {
  const closesAt = windowClosesAt(lastIncomingAt) ?? now;
  return Math.min(now + proposalLifetimeMs, closesAt);
}

/** Why the patient may not move an appointment themselves: it is handed off instead. */
export type MoveRefusal = "pastCutoff" | "moveUsed";

/**
 * Whether the patient may move the appointment starting at `startsAt` at
 * `now` (docs/domain/assistant.md § Cancelling and moving): until its medical
 * service's cutoff, and once. `patientMoves` counts their own moves of it
 * only, not the organization's.
 */
export function moveRefusal(
  appointment: { startsAt: number; cutoffHours: number; patientMoves: number },
  now: number,
): MoveRefusal | null {
  if (now > appointment.startsAt - appointment.cutoffHours * 60 * 60_000) {
    return "pastCutoff";
  }
  return appointment.patientMoves > 0 ? "moveUsed" : null;
}
