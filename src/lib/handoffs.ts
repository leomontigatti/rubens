import * as z from "zod";

// Handoffs (ui: "Derivación", docs/domain/assistant.md § Handoff): a
// conversation the assistant passes to a person. It is open until a person's
// reply reaches the patient, or a person closes it without a reply.

/** Why the conversation was handed off. */
export const handoffReasons = [
  /** The patient asked for a person, or to be contacted. */
  "patientAsked",
  /** A rule refused what the patient wants: past the cutoff, the one move used (#174). */
  "ruleRefused",
  /** The patient wants a new time for an appointment the organization cancelled. */
  "organizationCancelled",
  /** A clinical question or detail. */
  "clinical",
  /** A message judged an emergency. */
  "emergency",
  /** The answer to a follow-up was not plainly good. */
  "followUpAnswer",
  /** The assistant misunderstood the patient twice in a row. */
  "misunderstoodTwice",
  /** The number is not the contact of any patient. */
  "unknownNumber",
  /** The number's patients have no upcoming appointment. */
  "noUpcomingAppointment",
  /** The clinical check held the assistant's reply: clinical, or about another patient. */
  "heldReply",
] as const;

export type HandoffReason = (typeof handoffReasons)[number];

export const handoffStates = ["open", "closed"] as const;

export const handoffReferenceSchema = z.object({ handoffId: z.uuid() });

export type HandoffReference = z.input<typeof handoffReferenceSchema>;

/** Which open handoffs to list: all the reader sees, or one conversation's. */
export const openHandoffListSchema = z.object({ conversationId: z.uuid().optional() });

export type OpenHandoffListOptions = z.input<typeof openHandoffListSchema>;
