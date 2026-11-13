import { and, eq, isNotNull, lte, min } from "drizzle-orm";

import {
  maxReplyLength,
  personalReplySchema,
  returnTimeSchema,
  withSenderName,
} from "#/lib/conversation-holds.ts";
import type { PersonalReply, ReturnTimeInput } from "#/lib/conversation-holds.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { conversationReferenceSchema } from "#/lib/whatsapp-messages.ts";
import type { ConversationReference } from "#/lib/whatsapp-messages.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { readerOf } from "#/organization/inbox.ts";
import { queueLateReply } from "#/organization/late-replies.ts";
import { returnAfterHours, settleReply } from "#/organization/personal-replies.ts";
import type { Acting } from "#/organization/members.ts";
import { member } from "#/organization/schema.ts";
import { conversation, inboxSettings } from "#/organization/whatsapp-schema.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import { lastIncomingAt, whileSending } from "#/organization/whatsapp-messages.ts";
import type { Job } from "#/organization/jobs.ts";

// Taking a conversation over from the inbox (docs/domain/assistant.md §
// Inbox): anyone who reads a conversation can hold it, at any time, and the
// assistant stays silent in it while they do (`assistant.ts`), still judging
// each message. The holder replies to the patient under their name: inside
// the window it goes at once, after it the reply waits behind the reopen
// template (`late-replies.ts`); a reply that reaches the patient closes the
// open handoffs its writer may answer (`personal-replies.ts`). The conversation goes back to the assistant when the
// holder returns it, or by the object's alarm after the admin's return time,
// with no message: the assistant answers the patient's next one.

const hourMs = 60 * 60_000;

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
  return found ? { ...found, keepsRecords: reader.keepsRecords } : null;
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
 * conversation; the open handoffs they may answer close with it (one to the
 * practitioner only for a practitioner who keeps clinical records), and
 * their hold runs the return time again
 * from it. After the window closed the reply is held instead, behind the
 * reopen template (`late-replies.ts`), and goes when the patient answers.
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
  if (cloud.missingSetting()) {
    return { ok: false as const, reason: "notConnected" as const };
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
  const now = Date.now();
  if (!isWindowOpen(lastIncomingAt(database, conversationId), now)) {
    // Held behind the reopen template, which waits out a hold of Meta's like any other.
    const writer = { userId: acting.userId, keepsRecords: found.keepsRecords };
    const queued = queueLateReply(database, writer, { conversationId, phone: found.phone, text });
    return queued.ok ? { ok: true as const, held: true } : queued;
  }
  if (activeHold(database, now)) {
    return { ok: false as const, reason: "numberHeld" as const };
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
  database.transaction((tx) =>
    settleReply(database, tx, {
      writtenBy: acting.userId,
      conversationId,
      phone: found.phone,
      keepsRecords: found.keepsRecords,
      since: sendingFrom,
      whatsappId: sent.messageId,
      text,
    }),
  );
  return { ok: true as const, held: false };
}

/**
 * Gives a conversation `acting` holds back to the assistant, which says
 * nothing until the patient writes again.
 */
export function returnConversation(
  database: Database,
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
  return { ok: true as const };
}

function release(database: Database, conversationId: string) {
  database.transaction((tx) =>
    tx
      .update(conversation)
      .set({ heldBy: null, heldUntil: null })
      .where(eq(conversation.id, conversationId))
      .run(),
  );
}

/** When the next hold ends, or `null` when nobody holds a conversation. */
function nextReturnAlarm(database: Database): number | null {
  const next = database
    .select({ at: min(conversation.heldUntil) })
    .from(conversation)
    .where(isNotNull(conversation.heldBy))
    .get();
  return next?.at ?? null;
}

/**
 * Gives every conversation whose hold ended back to the assistant: the
 * object's alarm. Nothing is sent; the assistant answers the patient's next message.
 */
function returnDueConversations(database: Database) {
  database
    .update(conversation)
    .set({ heldBy: null, heldUntil: null })
    .where(and(isNotNull(conversation.heldBy), lte(conversation.heldUntil, Date.now())))
    .run();
}

/** The conversations a member holds, given back to the assistant when the hold ends. */
export const conversationReturnsJob: Job = {
  name: "conversation returns",
  nextDue: (database) => nextReturnAlarm(database),
  run: (database) => returnDueConversations(database),
};
