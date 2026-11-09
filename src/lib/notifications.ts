import * as z from "zod";

// Notifications to staff (docs/domain/messages.md § To staff): an event shown
// in the app to the members it concerns, each read or unread on its own. The
// first kinds are Meta's limits on the organization's number and templates
// (§ When Meta limits the number), which every admin gets, and handoffs,
// which their recipients get (docs/domain/assistant.md § Handoff).

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
] as const;

export type NotificationKind = (typeof notificationKinds)[number];

export const notificationReferenceSchema = z.object({ notificationId: z.uuid() });

export type NotificationReference = z.input<typeof notificationReferenceSchema>;

/** How many of a member's latest notifications the list shows. */
export const notificationListSize = 50;
