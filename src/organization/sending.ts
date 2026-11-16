import { isWindowOpen } from "#/lib/conversation-window.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { settleFailedReplies } from "#/organization/failed-replies.ts";
import type {
  MetaError,
  SendResult,
  TemplateMessage,
  WhatsappCloud,
} from "#/organization/graph-api.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import {
  isHeld,
  lastIncomingAt,
  storeOutgoing,
  whileSending,
} from "#/organization/whatsapp-messages.ts";

// How a message leaves the organization's number (docs/domain/messages.md §
// When Meta limits the number): whether it may go now, the call to Meta, the
// hold a limit on the number sets, and the stored message, with any status
// Meta reported before its send returned. The only caller of Meta's sends:
// each sender keeps only what each outcome means for it.

/** A message to send: the assistant's, a person's from the inbox or a late reply, or a template. */
export type OutgoingMessage =
  | {
      kind: "assistant";
      conversationId: string;
      phone: string;
      text: string;
      /** The communication rules' version it was written under. */
      rulesVersion: number;
      /** The emergency reply, which goes though a member holds the conversation. */
      emergency: boolean;
      /** Goes though a member holds the conversation: the answer to a patient's tap (ADR-0014). */
      whoeverHolds?: boolean;
    }
  | { kind: "person"; conversationId: string; phone: string; text: string; sentBy: string }
  | { kind: "template"; template: TemplateMessage; text: string };

/** Why a message may not go now. */
type Unreachable =
  | { ok: false; reason: "notConnected" | "windowClosed" | "conversationHeld" }
  | { ok: false; reason: "numberHeld"; until: number | null };

export type Reach = { ok: true } | Unreachable;

/** Why a send did not go: it could not go now, Meta was not reached, or Meta refused it. */
export type SendFailure =
  | Unreachable
  | { ok: false; reason: "notReached" }
  /** Refused for a limit on the number, which is now held. */
  | { ok: false; reason: "limited" }
  | { ok: false; reason: "refused"; metaError: MetaError };

/** The stored outgoing message, by its id and Meta's. */
export interface Sent {
  id: string;
  whatsappId: string;
}

/**
 * Whether the number may send now: Meta's settings are complete and no hold
 * of Meta's keeps it from sending. With a conversation, whether a free-form
 * message may reach it too: its window is open and, unless `whoeverHolds`, no
 * member holds it.
 */
export function reach(
  database: Writer,
  cloud: WhatsappCloud,
  to?: { conversationId: string; whoeverHolds: boolean },
): Reach {
  if (to && !to.whoeverHolds && isHeld(database, to.conversationId)) {
    return { ok: false, reason: "conversationHeld" };
  }
  if (cloud.missingSetting()) {
    return { ok: false, reason: "notConnected" };
  }
  const now = Date.now();
  if (to && !isWindowOpen(lastIncomingAt(database, to.conversationId), now)) {
    return { ok: false, reason: "windowClosed" };
  }
  const hold = activeHold(database, now);
  return hold ? { ok: false, reason: "numberHeld", until: hold.until } : { ok: true };
}

function reachOf(database: Writer, cloud: WhatsappCloud, message: OutgoingMessage) {
  if (message.kind === "template") {
    return reach(database, cloud);
  }
  const whoeverHolds =
    message.kind === "person" || message.emergency || message.whoeverHolds === true;
  return reach(database, cloud, { conversationId: message.conversationId, whoeverHolds });
}

function callMeta(cloud: WhatsappCloud, message: OutgoingMessage): Promise<SendResult> {
  return message.kind === "template"
    ? cloud.sendTemplate(message.template)
    : cloud.sendText({ to: message.phone, text: message.text });
}

function storedAs(message: OutgoingMessage, accepted: { messageId: string; waId: string | null }) {
  if (message.kind === "template") {
    const { template } = message;
    return {
      // Meta's id for the recipient is the number their replies come from.
      phone: accepted.waId ? `+${accepted.waId}` : template.to,
      whatsappId: accepted.messageId,
      type: "template",
      text: message.text,
      payload: JSON.stringify({
        template: template.templateName,
        language: template.languageCode,
        parameters: template.parameters,
      }),
    };
  }
  return {
    phone: message.phone,
    whatsappId: accepted.messageId,
    type: "text",
    text: message.text,
    payload: JSON.stringify({ text: message.text }),
    ...(message.kind === "assistant"
      ? { rulesVersion: message.rulesVersion }
      : { sentBy: message.sentBy }),
  };
}

/**
 * Sends `message` if it may go now, read again here, and stores it once Meta
 * accepts it; `settle` makes the sender's own writes in the transaction that
 * stores it. A refusal for a limit on the number holds the number first.
 */
export async function send(
  database: Database,
  cloud: WhatsappCloud,
  message: OutgoingMessage,
  settle?: (tx: Writer, sent: Sent) => void,
): Promise<{ ok: true; sent: Sent } | SendFailure> {
  const reached = reachOf(database, cloud, message);
  if (!reached.ok) {
    return reached;
  }
  const answer = await whileSending(database, () => callMeta(cloud, message)).catch(
    (error: unknown) => {
      // The error's message can carry the request, so only its class is logged.
      const where = message.kind === "template" ? "" : ` in conversation ${message.conversationId}`;
      console.error(
        `[whatsapp-send] send to Meta threw${where}:`,
        error instanceof Error ? error.name : typeof error,
      );
      return null;
    },
  );
  if (!answer) {
    return { ok: false, reason: "notReached" };
  }
  if (!answer.ok) {
    return holdOnRefusal(database, answer.metaError)
      ? { ok: false, reason: "limited" }
      : { ok: false, reason: "refused", metaError: answer.metaError };
  }
  const sent = database.transaction((tx) => {
    const stored = storeOutgoing(database, tx, storedAs(message, answer));
    const one = { id: stored.id, whatsappId: answer.messageId };
    settle?.(tx, one);
    // Meta may have reported a person's reply failed before its send returned.
    settleFailedReplies(tx, [answer.messageId]);
    return one;
  });
  return { ok: true, sent };
}
