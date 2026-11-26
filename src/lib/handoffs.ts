import * as z from "zod";

import type { MoveRefusal, ProposalKind } from "#/lib/proposals.ts";
import type { MediaType } from "#/lib/whatsapp-messages.ts";

// Handoffs (ui: "Derivación", docs/domain/assistant.md § Handoff): a
// conversation the assistant passes to a person, the practitioner when it
// needs one, otherwise reception.

export const handoffReasons = [
  /** The patient asked for a person, or to be contacted. */
  "patientAsked",
  /** A rule refused what the patient wants: past the cutoff, the one move used (#174). */
  "ruleRefused",
  /** The patient wants a new time for an appointment the organization cancelled. */
  "organizationCancelled",
  /** A question only the practitioner can answer: advice, a medicine or a treatment. */
  "clinical",
  /** A message judged an emergency. */
  "emergency",
  /** The answer to a follow-up was not plainly good. */
  "followUpAnswer",
  /** The assistant misunderstood the patient twice in a row. */
  "misunderstoodTwice",
  /** A voice note nobody could understand, after a misunderstanding: the patient was asked to write. */
  "voiceUnintelligible",
  /** The number is not the contact of any patient. */
  "unknownNumber",
  /** The number's patients have no upcoming appointment. */
  "noUpcomingAppointment",
  /** The clinical check held the assistant's reply: clinical, or about another patient. */
  "heldReply",
  /** A code check held the assistant's reply: it named something internal, or announced a silent handoff. */
  "leakedReply",
  /** The window closed before the assistant's reply could go, so it was dropped. */
  "windowClosed",
  /** The model could not read the patient's message before the hand-off time. */
  "modelUnavailable",
  /** A photo, a video or a file, which never reaches the model. */
  "media",
  /** A health question no upcoming appointment's practitioner treats: reception decides who sees it. */
  "unmatchedHealthQuestion",
] as const;

export type HandoffReason = (typeof handoffReasons)[number];

export const heldReplyChecks = [
  /** The clinical check: clinical, about another patient, or unchecked. */
  "clinical",
  /** It named a tool, or one of the prompt's marks or notes. */
  "internals",
  /** It told the patient it passed the conversation on, in a turn that tells them nothing. */
  "announcedHandoff",
] as const;

export type HeldReplyCheck = (typeof heldReplyChecks)[number];

/**
 * What the turn that made a handoff to reception knew, for its notification
 * to say why without the conversation read back: the move a rule refused,
 * and the changes the same turn made, each as the patient was told it.
 */
export interface HandoffDetail {
  refused: { why: MoveRefusal; cutoffHours: number; date: string; time: string } | null;
  applied: { kind: ProposalKind; date: string; time: string; newDate?: string; newTime?: string }[];
  /** For a `media` handoff, what the patient sent, so its reason names only that. */
  media?: MediaType[];
}

export const handoffStates = ["open", "closed"] as const;

export const handoffReferenceSchema = z.object({ handoffId: z.uuid() });

export type HandoffReference = z.input<typeof handoffReferenceSchema>;

export const openHandoffListSchema = z.object({ conversationId: z.uuid().optional() });

export type OpenHandoffListOptions = z.input<typeof openHandoffListSchema>;
