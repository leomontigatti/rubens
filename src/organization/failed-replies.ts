import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { boundAsOne } from "#/organization/database.ts";
import type { Writer } from "#/organization/database.ts";
import { notifiedPatientOf, notify } from "#/organization/notifications.ts";
import { handoff, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A person's reply that Meta reports as failed (docs/domain/assistant.md §
// Handoff): it never reached the patient, so the handoffs it closed open
// again, unless one of their kind opened since, and its writer is told, with
// a link to the conversation. The message keeps its `failed` status, which
// the inbox shows. Called inside the transaction that stores the status.

/** Whether a handoff of `forPractitioner`'s kind is open in `conversationId`. */
function kindOpen(tx: Writer, conversationId: string, forPractitioner: boolean) {
  const found = tx
    .select({ id: handoff.id })
    .from(handoff)
    .where(
      and(
        eq(handoff.conversationId, conversationId),
        eq(handoff.state, "open"),
        eq(handoff.forPractitioner, forPractitioner),
      ),
    )
    .get();
  return found !== undefined;
}

/**
 * Reopens the handoffs each failed person's reply among `whatsappIds` closed,
 * and notifies its writer: called once a reply's status turns `failed`.
 */
export function settleFailedReplies(tx: Writer, whatsappIds: string[]) {
  const failed = tx
    .select({
      id: whatsappMessage.id,
      conversationId: whatsappMessage.conversationId,
      sentBy: whatsappMessage.sentBy,
    })
    .from(whatsappMessage)
    .where(
      and(
        inArray(whatsappMessage.whatsappId, boundAsOne(whatsappIds)),
        eq(whatsappMessage.direction, "outgoing"),
        eq(whatsappMessage.status, "failed"),
        isNotNull(whatsappMessage.sentBy),
      ),
    )
    // The newest first: its handoff is the one a later handoff of its kind would have replaced.
    .orderBy(desc(whatsappMessage.sentAt), desc(sql`${whatsappMessage}.rowid`))
    .all();
  for (const reply of failed) {
    const closed = tx
      .select({ id: handoff.id, forPractitioner: handoff.forPractitioner })
      .from(handoff)
      .where(and(eq(handoff.answeredBy, reply.id), eq(handoff.state, "closed")))
      .all();
    for (const one of closed) {
      // A handoff of its kind opened since has the conversation already.
      if (!kindOpen(tx, reply.conversationId, one.forPractitioner)) {
        tx.update(handoff)
          .set({ state: "open", closedAt: null, answeredBy: null })
          .where(eq(handoff.id, one.id))
          .run();
      }
    }
    notify(tx, [reply.sentBy!], {
      kind: "replyFailed",
      conversationId: reply.conversationId,
      patientId: notifiedPatientOf(tx, reply.conversationId),
    });
  }
}
