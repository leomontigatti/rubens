import { and, asc, desc, eq, gte, inArray, isNotNull, lte, min, or } from "drizzle-orm";

import { withSignOff } from "#/lib/assistant.ts";
import {
  defaultReturnAfterHours,
  maxReplyLength,
  personalReplySchema,
  returnedReply,
  returnTimeSchema,
  withSenderName,
} from "#/lib/conversation-holds.ts";
import type { PersonalReply, ReturnTimeInput } from "#/lib/conversation-holds.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { conversationReferenceSchema } from "#/lib/whatsapp-messages.ts";
import type { ConversationReference } from "#/lib/whatsapp-messages.ts";

import { maySend, sendReply } from "#/organization/assistant.ts";
import { recordAudit } from "#/organization/audit.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { openHandoffsOf } from "#/organization/handoffs.ts";
import { readerOf } from "#/organization/inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { member } from "#/organization/schema.ts";
import {
  conversation,
  handoff,
  inboxSettings,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import { lastIncomingAt, storeOutgoing, whileSending } from "#/organization/whatsapp-messages.ts";

// Taking a conversation over from the inbox (docs/domain/assistant.md §
// Inbox): anyone who reads a conversation can hold it, at any time, and the
// assistant stays silent in it while they do (`assistant.ts`), still judging
// each message. The holder replies to the patient under their name, inside
// the window; a reply that reaches the patient closes the open handoffs its
// writer may answer. The conversation goes back to the assistant when the
// holder returns it, or by the object's alarm after the admin's return time.

const hourMs = 60 * 60_000;

/** How long a hold lasts before the conversation goes back to the assistant, as the admin set it. */
export function returnAfterHours(database: Writer) {
  const row = database.select({ hours: inboxSettings.returnAfterHours }).from(inboxSettings).get();
  return row?.hours ?? defaultReturnAfterHours;
}

export function saveReturnTime(database: Database, acting: Acting, input: ReturnTimeInput) {
  const parsed = returnTimeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { hours } = parsed.data;
  return database.transaction((tx) => {
    const before = returnAfterHours(tx);
    tx.insert(inboxSettings)
      .values({ id: 1, returnAfterHours: hours })
      .onConflictDoUpdate({
        target: inboxSettings.id,
        set: { returnAfterHours: hours, updatedAt: Date.now() },
      })
      .run();
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "inboxSettings",
      entityId: "1",
      patientId: null,
      before: { returnAfterHours: before },
      after: { returnAfterHours: hours },
    });
    return { ok: true as const };
  });
}

/** The conversation `conversationId` when `acting` may read it (`inbox.ts`). */
function readable(database: Writer, acting: Acting, conversationId: string) {
  const reader = readerOf(database as Database, acting);
  const found = database
    .select({ id: conversation.id, phone: conversation.phone, heldBy: conversation.heldBy })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), reader.visible))
    .get();
  return found ? { ...found, readsClinical: reader.readsClinical } : null;
}

/** Makes `acting` the holder of a conversation they read, taking it from whoever held it. */
export function takeOverConversation(
  database: Database,
  acting: Acting,
  input: ConversationReference,
) {
  const parsed = conversationReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  return database.transaction((tx) => {
    const found = readable(tx, acting, parsed.data.conversationId);
    if (!found) {
      return { ok: false as const, reason: "notFound" as const };
    }
    const heldUntil = Date.now() + returnAfterHours(tx) * hourMs;
    tx.update(conversation)
      .set({ heldBy: acting.userId, heldUntil })
      .where(eq(conversation.id, found.id))
      .run();
    return { ok: true as const, heldUntil };
  });
}

/**
 * Sends `acting`'s reply to the patient under their name, when they hold the
 * conversation and its window is open; the open handoffs they may answer
 * close with it (a clinical one only for a practitioner who keeps clinical
 * records, whose reply is then withheld like clinical words), and their hold
 * runs the return time again from it.
 */
export async function replyToConversation(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: PersonalReply,
) {
  const parsed = personalReplySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { conversationId } = parsed.data;
  const found = readable(database, acting, conversationId);
  if (!found) {
    return { ok: false as const, reason: "notFound" as const };
  }
  if (found.heldBy !== acting.userId) {
    return { ok: false as const, reason: "notHolding" as const };
  }
  const now = Date.now();
  if (!isWindowOpen(lastIncomingAt(database, conversationId), now)) {
    return { ok: false as const, reason: "windowClosed" as const };
  }
  if (cloud.missingSetting()) {
    return { ok: false as const, reason: "notConnected" as const };
  }
  if (activeHold(database, now)) {
    return { ok: false as const, reason: "numberHeld" as const };
  }
  const { name } = database
    .select({ name: member.name })
    .from(member)
    .where(eq(member.userId, acting.userId))
    .get()!;
  const text = withSenderName(parsed.data.text, name);
  if (text.length > maxReplyLength) {
    return { ok: false as const, reason: "tooLong" as const };
  }
  const sendingFrom = Date.now();
  const sent = await whileSending(database, () => cloud.sendText({ to: found.phone, text })).catch(
    (error: unknown) => {
      // Meta was not reached: the member is told and tries again. The error's
      // message can carry the request, so only its class is logged.
      console.error(
        `[whatsapp-reply] send to Meta threw in conversation ${conversationId}:`,
        error instanceof Error ? error.name : typeof error,
      );
      return null;
    },
  );
  if (!sent?.ok) {
    if (sent) {
      // A limit on the number holds the outbox and the assistant too.
      holdOnRefusal(database, sent.metaError);
    }
    return { ok: false as const, reason: "sendFailed" as const };
  }
  settleReply(database, acting, {
    conversationId,
    phone: found.phone,
    readsClinical: found.readsClinical,
    sendingFrom,
    whatsappId: sent.messageId,
    text,
  });
  return { ok: true as const };
}

/** The open handoffs a reply answers: a clinical one only from a practitioner who keeps clinical records. */
function answeredHandoffs(database: Writer, conversationId: string, readsClinical: boolean) {
  return openHandoffsOf(database, conversationId).filter((one) => !one.clinical || readsClinical);
}

/**
 * Whether a clinical handoff of the conversation was open at any time since
 * `since`: one may open, and close, while Meta answers the reply that answers it.
 */
function clinicalHandoffOpenSince(tx: Writer, conversationId: string, since: number) {
  const found = tx
    .select({ id: handoff.id })
    .from(handoff)
    .where(
      and(
        eq(handoff.conversationId, conversationId),
        eq(handoff.clinical, true),
        or(eq(handoff.state, "open"), gte(handoff.closedAt, since)),
      ),
    )
    .get();
  return found !== undefined;
}

/**
 * Stores the reply Meta accepted, closes the open handoffs its writer may
 * answer, and runs their hold's return time again from it.
 */
function settleReply(
  database: Database,
  acting: Acting,
  reply: {
    conversationId: string;
    phone: string;
    readsClinical: boolean;
    /** When the send to Meta started. */
    sendingFrom: number;
    whatsappId: string;
    text: string;
  },
) {
  const { conversationId, text } = reply;
  database.transaction((tx) => {
    // Read after the send: a handoff may have opened while Meta answered.
    const answered = answeredHandoffs(tx, conversationId, reply.readsClinical);
    const clinical =
      reply.readsClinical && clinicalHandoffOpenSince(tx, conversationId, reply.sendingFrom);
    storeOutgoing(database, tx, {
      phone: reply.phone,
      whatsappId: reply.whatsappId,
      type: "text",
      text,
      payload: JSON.stringify({ text }),
      sentBy: acting.userId,
      judgement: clinical ? "clinical" : undefined,
    });
    if (answered.length > 0) {
      tx.update(handoff)
        .set({ state: "closed", closedAt: Date.now() })
        .where(
          inArray(
            handoff.id,
            answered.map((one) => one.id),
          ),
        )
        .run();
    }
    // Still theirs unless someone took it over while Meta answered.
    tx.update(conversation)
      .set({ heldUntil: Date.now() + returnAfterHours(tx) * hourMs })
      .where(and(eq(conversation.id, conversationId), eq(conversation.heldBy, acting.userId)))
      .run();
  });
}

/** Gives a conversation `acting` holds back to the assistant. */
export async function returnConversation(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: ConversationReference,
) {
  const parsed = conversationReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { conversationId } = parsed.data;
  const found = readable(database, acting, conversationId);
  if (!found) {
    return { ok: false as const, reason: "notFound" as const };
  }
  if (found.heldBy !== acting.userId) {
    return { ok: false as const, reason: "notHolding" as const };
  }
  release(database, conversationId);
  await sayReturned(database, cloud, conversationId);
  return { ok: true as const };
}

function release(database: Database, conversationId: string) {
  database
    .update(conversation)
    .set({ heldBy: null, heldUntil: null })
    .where(eq(conversation.id, conversationId))
    .run();
}

/** Whether the conversation's latest outgoing message is a member's reply. */
function personAnsweredLast(database: Database, conversationId: string) {
  const latest = database
    .select({ sentBy: whatsappMessage.sentBy })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "outgoing"),
      ),
    )
    .orderBy(desc(whatsappMessage.sentAt), desc(whatsappMessage.createdAt))
    .limit(1)
    .get();
  return latest?.sentBy != null;
}

/**
 * The assistant's message on taking the conversation back: only when a
 * person was the last to answer the patient, no handoff is still open (the
 * assistant stays silent while one is), and the assistant may send now,
 * the window open among it; otherwise it takes it back without a word.
 */
async function sayReturned(database: Database, cloud: WhatsappCloud, conversationId: string) {
  if (
    openHandoffsOf(database, conversationId).length > 0 ||
    !personAnsweredLast(database, conversationId) ||
    !maySend(database, cloud, conversationId)
  ) {
    return;
  }
  const rules = currentCommunicationRules(database);
  const checked = checkReply(withSignOff(returnedReply(rules.formOfAddress), rules.signOff));
  if (!checked.ok) {
    return;
  }
  const { phone } = database
    .select({ phone: conversation.phone })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get()!;
  await sendReply(database, cloud, { phone, text: checked.text, rulesVersion: rules.version });
}

/** When the next hold ends, or `null` when nobody holds a conversation. */
export function nextReturnAlarm(database: Database): number | null {
  const next = database
    .select({ at: min(conversation.heldUntil) })
    .from(conversation)
    .where(isNotNull(conversation.heldBy))
    .get();
  return next?.at ?? null;
}

/** Gives every conversation whose hold ended back to the assistant, earliest first: the object's alarm. */
export async function returnDueConversations(database: Database, cloud: WhatsappCloud) {
  const due = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(isNotNull(conversation.heldBy), lte(conversation.heldUntil, Date.now())))
    .orderBy(asc(conversation.heldUntil))
    .all();
  for (const { id } of due) {
    // Claimed only while still due: the holder may have replied or taken it again meanwhile.
    const claimed = database
      .update(conversation)
      .set({ heldBy: null, heldUntil: null })
      .where(and(eq(conversation.id, id), lte(conversation.heldUntil, Date.now())))
      .returning({ id: conversation.id })
      .get();
    if (claimed) {
      await sayReturned(database, cloud, id);
    }
  }
}
