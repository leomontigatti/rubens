import * as z from "zod";

import type { TemplateStatus } from "#/lib/whatsapp-templates.ts";

// WhatsApp messages as the organization's object stores them (ADR-0010), in
// the shape the webhook hands them over.

export const whatsappMessageDirections = ["incoming", "outgoing"] as const;

/** What Meta says of an outgoing message, in its own words, in the order they happen. */
export const whatsappMessageStatuses = ["sent", "delivered", "read", "failed"] as const;

export type WhatsappMessageStatus = (typeof whatsappMessageStatuses)[number];

export const messageJudgements = ["forPractitioner", "notForPractitioner"] as const;

export type MessageJudgement = (typeof messageJudgements)[number];

export const mediaTypes = ["image", "document", "video"] as const;

export type MediaType = (typeof mediaTypes)[number];

export interface IncomingWhatsappMessage {
  /** Meta's message id (`wamid.…`). */
  whatsappId: string;
  /** The sender's number, E.164. */
  from: string;
  /** When Meta says it was sent, Unix milliseconds. */
  sentAt: number;
  /** Meta's message type: `text`, `image`, `audio`, … */
  type: string;
  /** A text message's body, a reaction's emoji (empty for one taken back) or a tapped button's label; other types keep theirs in `payload`. */
  text: string | null;
  /** The message as Meta sent it, JSON. */
  payload: string;
  /** A reaction's target: the WhatsApp id of the message it reacts to. */
  reactsTo?: string;
  /** The WhatsApp id of the message it answers, when the patient replied to one or tapped its button. */
  repliesTo?: string;
  buttonPayload?: string;
}

export interface WhatsappStatusUpdate {
  whatsappId: string;
  status: WhatsappMessageStatus;
  /** When Meta says it happened, Unix milliseconds. */
  at: number;
}

export interface WhatsappTemplateStatusUpdate {
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
  templateCategories: WhatsappTemplateCategoryUpdate[];
  numberEvents: WhatsappNumberEvent[];
}

export const conversationReferenceSchema = z.object({ conversationId: z.uuid() });

export type ConversationReference = z.input<typeof conversationReferenceSchema>;

export const messageReferenceSchema = conversationReferenceSchema.extend({ messageId: z.uuid() });

export type MessageReference = z.input<typeof messageReferenceSchema>;

export const conversationPageSize = 25;

export const conversationListSchema = z.object({
  page: z.number().int().positive().default(1),
  query: z.string().trim().max(200).default(""),
  withHandoff: z.boolean().default(false),
});

export type ConversationListOptions = z.input<typeof conversationListSchema>;

/**
 * Meta's news about the organization's account or number, as the webhook
 * reads it (`account_update`, `phone_number_quality_update`): business-started
 * messages restricted until a time (`null`, until Meta lifts it) or no longer
 * restricted, the account disabled or reinstated, or a new messaging limit.
 */
export type WhatsappNumberEvent =
  | { kind: "restricted"; until: number | null }
  | { kind: "unrestricted" }
  | { kind: "disabled" }
  | { kind: "reinstated" }
  | { kind: "messagingLimit"; limit: string };

/** Meta moved a template to another category, in Meta's word for it (`MARKETING`). */
export interface WhatsappTemplateCategoryUpdate {
  metaId: string;
  category: string;
}
