import * as z from "zod";

// Notifications to staff (docs/domain/messages.md § To staff): an event shown
// in the app to the members it concerns, each read or unread on its own.

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

export const notificationListSize = 50;
