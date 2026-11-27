import { and, eq, lte } from "drizzle-orm";

import type { Database } from "#/organization/database.ts";
import { answeredMessage } from "#/organization/handoffs.ts";
import { readConversation } from "#/organization/turn-reading.ts";
import { retryOrHandOff } from "#/organization/turn-retries.ts";
import { conversation } from "#/organization/whatsapp-schema.ts";

// A turn's claim on its conversation's messages (`assistant.ts`): taken as
// the turn starts, released once it settles. A claim past its time belongs to
// a turn lost mid-way, to an eviction, a deploy or a throw out of the alarm,
// which is settled as a turn the model could not read.

/**
 * How long a turn holds its conversation's messages once it claims them: past
 * it, the alarm that ran the turn was lost before the turn settled. Longer than
 * a turn's bounded calls to the model and to Workers AI take.
 */
const turnClaimMs = 15 * 60_000;

/**
 * Claims the turn of `conversationId` while still due, its wait cleared
 * before the model runs: a message that arrived during an earlier turn of the
 * batch restarted the wait, and one that arrives during this one sets a new
 * wait. The claim holds until the turn settles, so a turn its alarm lost is
 * not lost with it. Says whether it claimed it.
 */
export function claimTurn(database: Database, conversationId: string) {
  const now = Date.now();
  const claimed = database.transaction((tx) =>
    tx
      .update(conversation)
      .set({ assistantDueAt: null, turnClaimedUntil: now + turnClaimMs })
      .where(and(eq(conversation.id, conversationId), lte(conversation.assistantDueAt, now)))
      .returning({ id: conversation.id })
      .get(),
  );
  return claimed !== undefined;
}

/**
 * Settles the turn of `conversationId` that was lost mid-way, once its claim
 * lapsed: as a turn the model could not read (`turn-retries.ts`), so it is
 * retried, each time later, or handed to reception, and a turn lost each time
 * it runs is not run again and again. A wait a newer message set is kept.
 */
export function settleLostTurn(database: Database, conversationId: string) {
  const lapsed = database
    .select({ claimedUntil: conversation.turnClaimedUntil })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), lte(conversation.turnClaimedUntil, Date.now())))
    .get();
  if (typeof lapsed?.claimedUntil !== "number") {
    return;
  }
  // Released only once its retry or handoff is stored: a throw before keeps the claim.
  retryUnread(database, conversationId, lapsed.claimedUntil - turnClaimMs);
  releaseTurn(database, conversationId);
}

/** Retries or hands off the messages still unjudged of the lost turn that started at `startedAt`. */
function retryUnread(database: Database, conversationId: string, startedAt: number) {
  const { unjudged } = readConversation(database, conversationId);
  if (unjudged.length === 0) {
    return;
  }
  const answered = answeredMessage(database, conversationId, unjudged);
  retryOrHandOff(database, {
    conversationId,
    messageIds: unjudged.map((message) => message.id),
    appointmentId: answered?.appointmentId ?? null,
    startedAt,
  });
}

export function releaseTurn(database: Database, conversationId: string) {
  database.transaction((tx) =>
    tx
      .update(conversation)
      .set({ turnClaimedUntil: null })
      .where(eq(conversation.id, conversationId))
      .run(),
  );
}
