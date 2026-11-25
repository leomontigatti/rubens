import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { defaultReturnAfterHours } from "#/lib/conversation-holds.ts";

import type { Writer } from "#/organization/database.ts";
import { mayAnswer } from "#/organization/conversation-access.ts";
import { openHandoffsOf } from "#/organization/handoffs.ts";
import { answeredByPerson } from "#/organization/turn-retries.ts";
import { conversation, handoff, inboxSettings } from "#/organization/whatsapp-schema.ts";

// A person's reply that reached the patient (docs/domain/assistant.md §
// Inbox, § Handoff): sent inside the window from the inbox
// (`conversation-holds.ts`), or written after it closed and sent once the
// patient answered the reopen template (`late-replies.ts`). Either way it
// closes the open handoffs its writer may answer.

const hourMs = 60 * 60_000;

/** How long a hold lasts before the conversation goes back to the assistant, as the admin set it. */
export function returnAfterHours(database: Writer) {
  const row = database.select({ hours: inboxSettings.returnAfterHours }).from(inboxSettings).get();
  return row?.hours ?? defaultReturnAfterHours;
}

/**
 * The open handoffs a reply answers, those its writer may answer
 * (`handoffs.ts`); for a late reply, only those opened before it was
 * written, since a later one is about a message it never read.
 */
function answeredHandoffs(
  database: Writer,
  conversationId: string,
  reply: { writtenBy: string; keepsRecords: boolean; writtenAt?: number },
) {
  const writer = { memberId: reply.writtenBy, keepsRecords: reply.keepsRecords };
  return openHandoffsOf(database, conversationId).filter(
    (one) =>
      mayAnswer(database, one, writer) &&
      (reply.writtenAt === undefined || one.createdAt <= reply.writtenAt),
  );
}

/**
 * Settles the reply `sending.ts` stored once Meta accepted it, in its
 * transaction: closes the open handoffs its writer may answer, and runs
 * their hold's return time again from it. A late reply
 * makes its writer the holder again while nobody holds it, since the patient
 * just answered them.
 */
export function settleReply(
  tx: Writer,
  reply: {
    writtenBy: string;
    conversationId: string;
    keepsRecords: boolean;
    /** Up to when the patient's messages it answers go: when it was written or its send started. */
    since: number;
    /** For a late reply: when it was written. */
    writtenAt?: number;
  },
  stored: { id: string },
) {
  const { conversationId, writtenBy } = reply;
  // Read after the send: a handoff may have opened while Meta answered.
  const answered = answeredHandoffs(tx, conversationId, reply);
  answeredByPerson(tx, conversationId, reply.writtenAt ?? reply.since);
  if (answered.length > 0) {
    tx.update(handoff)
      .set({
        state: "closed",
        closedAt: Date.now(),
        heldReply: null,
        heldBecause: null,
        answeredBy: stored.id,
      })
      .where(
        inArray(
          handoff.id,
          answered.map((one) => one.id),
        ),
      )
      .run();
  }
  // Still theirs unless someone took it over while Meta answered.
  const theirs = eq(conversation.heldBy, writtenBy);
  tx.update(conversation)
    .set({ heldBy: writtenBy, heldUntil: Date.now() + returnAfterHours(tx) * hourMs })
    .where(
      and(
        eq(conversation.id, conversationId),
        reply.writtenAt === undefined ? theirs : or(theirs, isNull(conversation.heldBy)),
      ),
    )
    .run();
}
