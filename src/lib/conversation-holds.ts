import * as z from "zod";

import type { FormOfAddress } from "#/lib/communication-rules.ts";

// Taking a conversation over from the inbox (docs/domain/assistant.md §
// Inbox): a member holds it while the assistant stays silent in it, replies
// to the patient under their own name, and the conversation goes back to the
// assistant when they return it or after the admin's return time.

/** How long a member holds a conversation before it goes back to the assistant, until an admin sets it (#151). */
export const defaultReturnAfterHours = 4;

export const maxReturnAfterHours = 24;

export const returnTimeSchema = z.object({
  hours: z.number().int().min(1).max(maxReturnAfterHours),
});

export type ReturnTimeInput = z.input<typeof returnTimeSchema>;

/** Meta's limit on a text message's body. */
export const maxReplyLength = 4096;

export const personalReplySchema = z.object({
  conversationId: z.uuid(),
  text: z.string().trim().min(1).max(maxReplyLength),
});

export type PersonalReply = z.input<typeof personalReplySchema>;

/** A person's reply as the patient reads it on WhatsApp: under their name, in bold. */
export function withSenderName(text: string, name: string): string {
  return `*${name}*\n${text}`;
}

/**
 * What the patient is told when the assistant takes the conversation back
 * after a person answered: that they can keep writing here. Fixed, so it
 * promises nothing the model wrote.
 */
export function returnedReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Gracias por su paciencia. Si necesita algo más sobre su turno, escríbanos por acá."
    : "Gracias por tu paciencia. Si necesitás algo más sobre tu turno, escribinos por acá.";
}
