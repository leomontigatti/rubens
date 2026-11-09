import * as z from "zod";

// Handoffs (ui: "Derivación", docs/domain/assistant.md § Handoff): a
// conversation the assistant passes to a person. It is open until a person's
// reply reaches the patient, or a person closes it without a reply. One made
// inside the conversation window counts back from its close: its recipients
// are reminded, then every other member who may answer it.

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

/** The most hours before the close a reminder can go: the window lasts 24. */
export const maxReminderHours = 23;

export const handoffReferenceSchema = z.object({ handoffId: z.uuid() });

export type HandoffReference = z.input<typeof handoffReferenceSchema>;

/** Which open handoffs to list: all the reader sees, or one conversation's. */
export const openHandoffListSchema = z.object({ conversationId: z.uuid().optional() });

export type OpenHandoffListOptions = z.input<typeof openHandoffListSchema>;

/** How many hours before the window closes a handoff's reminders go, until an admin sets them (#151). */
export const defaultHandoffReminders = { recipientHours: 6, othersHours: 2 } as const;

/**
 * The handoff reminders an admin sets, in whole hours before the window
 * closes: none can fall after the close, nor before the window opens.
 */
export const handoffRemindersSchema = z.object({
  recipientHours: z.number().int().min(1).max(maxReminderHours),
  othersHours: z.number().int().min(1).max(maxReminderHours),
});

export type HandoffRemindersInput = z.input<typeof handoffRemindersSchema>;
