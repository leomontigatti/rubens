import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";

import { defaultReturnAfterHours } from "#/lib/conversation-holds.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { openHandoffsOf } from "#/organization/handoffs.ts";
import { answeredByPerson } from "#/organization/turn-retries.ts";
import { conversation, handoff, inboxSettings } from "#/organization/whatsapp-schema.ts";
import { storeOutgoing } from "#/organization/whatsapp-messages.ts";

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
 * The open handoffs a reply answers: a clinical one only from a practitioner
 * who keeps clinical records; for a late reply, only those opened before it
 * was written, since a later one is about a message it never read.
 */
function answeredHandoffs(
  database: Writer,
  conversationId: string,
  reply: { readsClinical: boolean; writtenAt?: number },
) {
  return openHandoffsOf(database, conversationId).filter(
    (one) =>
      (!one.clinical || reply.readsClinical) &&
      (reply.writtenAt === undefined || one.createdAt <= reply.writtenAt),
  );
}

/**
 * Whether a clinical handoff of the conversation was open at any time since
 * `since`: one may open, and close, while Meta answers the reply that answers it.
 */
export function clinicalHandoffOpenSince(tx: Writer, conversationId: string, since: number) {
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
 * answer, and runs their hold's return time again from it. A late reply
 * makes its writer the holder again while nobody holds it, since the patient
 * just answered them.
 */
export function settleReply(
  database: Database,
  tx: Writer,
  reply: {
    writtenBy: string;
    conversationId: string;
    phone: string;
    readsClinical: boolean;
    /** Since when a clinical handoff it answers counts: when it was written or its send started. */
    since: number;
    whatsappId: string;
    text: string;
    /** For a late reply: when it was written. */
    writtenAt?: number;
  },
) {
  const { conversationId, text, writtenBy } = reply;
  // Read after the send: a handoff may have opened while Meta answered.
  const answered = answeredHandoffs(tx, conversationId, reply);
  const clinical = reply.readsClinical && clinicalHandoffOpenSince(tx, conversationId, reply.since);
  const stored = storeOutgoing(database, tx, {
    phone: reply.phone,
    whatsappId: reply.whatsappId,
    type: "text",
    text,
    payload: JSON.stringify({ text }),
    sentBy: writtenBy,
    judgement: clinical ? "clinical" : undefined,
  });
  if (reply.readsClinical) {
    answeredByPerson(tx, conversationId, reply.writtenAt ?? reply.since);
  }
  if (answered.length > 0) {
    tx.update(handoff)
      .set({ state: "closed", closedAt: Date.now(), heldReply: null })
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
  return stored;
}
