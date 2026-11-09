import * as z from "zod";

import type { TemplateStatus } from "#/lib/whatsapp-templates.ts";

// WhatsApp messages as the organization's object stores them (ADR-0010), in
// the shape the webhook hands them over: Meta's payload is read in
// `src/server/whatsapp-webhook.ts`, never here.

export const whatsappMessageDirections = ["incoming", "outgoing"] as const;

/** What Meta says of an outgoing message, in its own words, in the order they happen. */
export const whatsappMessageStatuses = ["sent", "delivered", "read", "failed"] as const;

export type WhatsappMessageStatus = (typeof whatsappMessageStatuses)[number];

/**
 * The assistant's judgement of a patient's message (docs/domain/assistant.md
 * § Inbox); a message it has not judged yet has none.
 */
export const messageJudgements = ["clinical", "notClinical"] as const;

export type MessageJudgement = (typeof messageJudgements)[number];

/** A message a patient's number sent the organization's number. */
export interface IncomingWhatsappMessage {
  /** Meta's message id (`wamid.…`). */
  whatsappId: string;
  /** The sender's number, E.164. */
  from: string;
  /** When Meta says it was sent, Unix milliseconds. */
  sentAt: number;
  /** Meta's message type: `text`, `image`, `audio`, … */
  type: string;
  /** A text message's body; other types keep theirs in `payload`. */
  text: string | null;
  /** The message as Meta sent it, JSON. */
  payload: string;
}

/** Meta's news about a message the organization's number sent. */
export interface WhatsappStatusUpdate {
  whatsappId: string;
  status: WhatsappMessageStatus;
  /** When Meta says it happened, Unix milliseconds. */
  at: number;
}

/** Meta's news about a template the organization submitted. */
export interface WhatsappTemplateStatusUpdate {
  /** Meta's id for the template. */
  metaId: string;
  status: TemplateStatus;
  /** Meta's reason for a rejection, such as `INVALID_FORMAT`. */
  reason: string | null;
}

/** What one webhook call carries for one organization. */
export interface WhatsappEvents {
  messages: IncomingWhatsappMessage[];
  statuses: WhatsappStatusUpdate[];
  templateStatuses: WhatsappTemplateStatusUpdate[];
}

export const conversationReferenceSchema = z.object({ conversationId: z.uuid() });

export type ConversationReference = z.input<typeof conversationReferenceSchema>;

export const conversationPageSize = 25;

/** A page of the inbox, and what the search box holds; the search text stays out of the URL. */
export const conversationListSchema = z.object({
  page: z.number().int().positive().default(1),
  query: z.string().trim().max(200).default(""),
});

export type ConversationListOptions = z.input<typeof conversationListSchema>;
