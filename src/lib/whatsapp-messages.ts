// WhatsApp messages as the organization's object stores them (ADR-0010), in
// the shape the webhook hands them over: Meta's payload is read in
// `src/server/whatsapp-webhook.ts`, never here.

export const whatsappMessageDirections = ["incoming", "outgoing"] as const;

/** What Meta says of an outgoing message, in its own words, in the order they happen. */
export const whatsappMessageStatuses = ["sent", "delivered", "read", "failed"] as const;

export type WhatsappMessageStatus = (typeof whatsappMessageStatuses)[number];

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

/** What one webhook call carries for one organization. */
export interface WhatsappEvents {
  messages: IncomingWhatsappMessage[];
  statuses: WhatsappStatusUpdate[];
}
