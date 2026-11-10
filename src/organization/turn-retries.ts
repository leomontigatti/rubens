import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { windowClosesAt } from "#/lib/conversation-window.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { addsToOpen, openHandoff, openHandoffsOf } from "#/organization/handoffs.ts";
import type { HandoffWanted } from "#/organization/handoffs.ts";
import { conversation, proposal, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";

// A turn the model could not read (docs/domain/assistant.md § The conversation
// window): the patient's messages stay unjudged and unanswered, and the turn
// runs again from the alarm, each time a little later, while the window is
// open. Still unread at the hand-off time, they go to a person as a clinical
// handoff, since nobody knows what they say, and are stored as clinical: a
// person answers them, and no later turn reads them again as new. So are
// those a person answered meanwhile, by a reply or by closing a handoff. No
// code reads them in the model's place.

const minuteMs = 60_000;

/** The first retry's wait, doubled after each failure up to `longestRetryMs`. */
const firstRetryMs = minuteMs;

const longestRetryMs = 60 * minuteMs;

/** How long before the window closes an unread message is handed off (#151's default). */
const handOffBeforeCloseMs = 6 * 60 * minuteMs;

function retryWait(failedTurns: number) {
  return Math.min(firstRetryMs * 2 ** failedTurns, longestRetryMs);
}

/**
 * Whether the turn that started at `startedAt` accepted a proposal before the
 * model failed: the change is made, and a retry would read the patient's
 * words again against the appointments it left, acting on them twice.
 */
function changedSince(database: Database, conversationId: string, startedAt: number) {
  const accepted = database
    .select({ id: proposal.id })
    .from(proposal)
    .where(and(eq(proposal.conversationId, conversationId), gte(proposal.acceptedAt, startedAt)))
    .get();
  return accepted !== undefined;
}

/**
 * Settles a turn the model could not read, whose unread messages are
 * `messageIds`: sets its retry, or past the hand-off time, or once the turn
 * made a change, opens the clinical handoff, to the practitioner of
 * `appointmentId` when it has one, and stops retrying until the patient
 * writes again. A wait a newer message set while the model ran is kept.
 */
export function retryOrHandOff(
  database: Database,
  turn: {
    conversationId: string;
    messageIds: string[];
    appointmentId: string | null;
    startedAt: number;
  },
) {
  const { conversationId, appointmentId } = turn;
  const now = Date.now();
  const changed = changedSince(database, conversationId, turn.startedAt);
  database.transaction((tx) => {
    const { failedTurns } = tx
      .select({ failedTurns: conversation.failedTurns })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get()!;
    const closesAt = windowClosesAt(lastIncomingAt(tx, conversationId)) ?? now;
    const handOffAt = closesAt - handOffBeforeCloseMs;
    if (now < handOffAt && !changed) {
      const retryAt = Math.min(now + retryWait(failedTurns), handOffAt);
      tx.update(conversation)
        .set({
          failedTurns: failedTurns + 1,
          assistantDueAt: sql`coalesce(${conversation.assistantDueAt}, ${retryAt})`,
        })
        .where(eq(conversation.id, conversationId))
        .run();
      return;
    }
    const wanted: HandoffWanted = { reason: "modelUnavailable", clinical: true, appointmentId };
    if (addsToOpen(openHandoffsOf(tx, conversationId), wanted)) {
      openHandoff(tx, conversationId, wanted);
    }
    tx.update(whatsappMessage)
      .set({ judgement: "clinical" })
      .where(and(inArray(whatsappMessage.id, turn.messageIds), isNull(whatsappMessage.judgement)))
      .run();
    tx.update(conversation)
      .set({ failedTurns: 0 })
      .where(eq(conversation.id, conversationId))
      .run();
  });
}

export function clearFailedTurns(database: Database, conversationId: string) {
  database
    .update(conversation)
    .set({ failedTurns: 0 })
    .where(eq(conversation.id, conversationId))
    .run();
}

/**
 * Stores as clinical the messages of `conversationId` the model could not
 * read, sent up to `upTo`, once a person who reads clinical words answered
 * them, by a reply or by closing a handoff, and stops their retry: a retry
 * would read them as new after that answer, and act on them twice. Only
 * while the model is failing: a message waiting for its first turn is still
 * the assistant's to judge.
 */
export function answeredByPerson(tx: Writer, conversationId: string, upTo: number) {
  const failing = tx
    .update(conversation)
    .set({ failedTurns: 0 })
    .where(and(eq(conversation.id, conversationId), gt(conversation.failedTurns, 0)))
    .returning({ id: conversation.id })
    .get();
  if (!failing) {
    return;
  }
  const unread = and(
    eq(whatsappMessage.conversationId, conversationId),
    eq(whatsappMessage.direction, "incoming"),
    isNull(whatsappMessage.judgement),
  );
  tx.update(whatsappMessage)
    .set({ judgement: "clinical" })
    .where(and(unread, lte(whatsappMessage.sentAt, upTo)))
    .run();
  const stillUnread = tx
    .select({ id: whatsappMessage.id })
    .from(whatsappMessage)
    .where(unread)
    .get();
  if (!stillUnread) {
    tx.update(conversation)
      .set({ assistantDueAt: null })
      .where(eq(conversation.id, conversationId))
      .run();
  }
}

/**
 * Whether a person answered any of `messageIds` while a turn reading them
 * ran (`answeredByPerson`): the turn then acts on nothing and says nothing,
 * since its words were answered after it read them.
 */
export function answeredMeanwhile(database: Writer, messageIds: string[]) {
  const judged = database
    .select({ id: whatsappMessage.id })
    .from(whatsappMessage)
    .where(and(inArray(whatsappMessage.id, messageIds), isNotNull(whatsappMessage.judgement)))
    .get();
  return judged !== undefined;
}
