import * as z from "zod";

// Taking a conversation over from the inbox (docs/domain/assistant.md § Inbox).

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

/**
 * Where a person's reply written after the window closed stands (docs/domain/
 * assistant.md § Handoff): waiting for the patient to answer the reopen
 * template, delivered once they did, not delivered because they never did, or
 * withdrawn by its writer while it waited.
 */
export const lateReplyStates = ["waiting", "delivered", "notDelivered", "withdrawn"] as const;

export type LateReplyState = (typeof lateReplyStates)[number];

export const lateReplyReferenceSchema = z.object({ lateReplyId: z.uuid() });

export type LateReplyReference = z.input<typeof lateReplyReferenceSchema>;

export const lateReplyChanceMs = 7 * 24 * 60 * 60_000;

/** A person's reply as the patient reads it on WhatsApp: under their name, in bold. */
export function withSenderName(text: string, name: string): string {
  return `*${name}*\n${text}`;
}
