import * as z from "zod";

// Notifications to staff (docs/domain/messages.md § To staff): an event shown
// in the app to the members it concerns, each read or unread on its own. The
// first kinds are Meta's limits on the organization's number and templates
// (§ When Meta limits the number), which every admin gets; handoffs, which
// their recipients get, and their reminders before the window closes
// (docs/domain/assistant.md § Handoff); a person's reply written after the
// window closed that never reached the patient, which its writer gets; and
// replies that look like opt-outs, which reception and the admins get, one
// per patient whose WhatsApp consent a person may turn off, and again daily
// while nobody decided on the patient (`src/organization/opt-out-holds.ts`);
// and a cancellation a patient made through the assistant, which reception
// and the admins get, so they can fill the time.

export const notificationKinds = [
  "templateRejected",
  "templatePaused",
  "templateDisabled",
  "templateRecategorized",
  "numberRestricted",
  "numberDisabled",
  "numberRateLimited",
  "messagingLimitLowered",
  "handoff",
  "handoffReminder",
  "replyNotDelivered",
  /** A message judged an emergency in a conversation the member holds: the patient got the emergency reply. */
  "emergency",
  /** Meta reported a person's reply failed: the handoff it closed is open again. */
  "replyFailed",
  "optOut",
  "optOutReminder",
  /** A patient cancelled an appointment through the assistant: its time is free. */
  "appointmentCancelled",
] as const;

export type NotificationKind = (typeof notificationKinds)[number];

export const notificationReferenceSchema = z.object({ notificationId: z.uuid() });

export type NotificationReference = z.input<typeof notificationReferenceSchema>;

/** How many of a member's latest notifications the list shows. */
export const notificationListSize = 50;
