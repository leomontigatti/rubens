import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { Writer } from "#/organization/database.ts";
import { notify } from "#/organization/notifications.ts";
import { conversationPatient, handoff, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A person's reply that Meta reports as failed (docs/domain/assistant.md §
// Handoff): it never reached the patient, so the handoffs it closed open
// again, and its writer is told, with a link to the conversation. The
// message keeps its `failed` status, which the inbox shows.

/**
 * Reopens the handoffs each failed person's reply among `whatsappIds` closed,
 * and notifies its writer: called once a reply's status turns `failed`.
 */
export function settleFailedReplies(tx: Writer, whatsappIds: string[]) {
  const failed =
    whatsappIds.length === 0
      ? []
      : tx
          .select({
            id: whatsappMessage.id,
            conversationId: whatsappMessage.conversationId,
            sentBy: whatsappMessage.sentBy,
          })
          .from(whatsappMessage)
          .where(
            and(
              inArray(whatsappMessage.whatsappId, whatsappIds),
              eq(whatsappMessage.direction, "outgoing"),
              eq(whatsappMessage.status, "failed"),
              isNotNull(whatsappMessage.sentBy),
            ),
          )
          .all();
  for (const reply of failed) {
    tx.update(handoff)
      .set({ state: "open", closedAt: null, answeredBy: null })
      .where(and(eq(handoff.answeredBy, reply.id), eq(handoff.state, "closed")))
      .run();
    const first = tx
      .select({ patientId: conversationPatient.patientId })
      .from(conversationPatient)
      .where(eq(conversationPatient.conversationId, reply.conversationId))
      .get();
    notify(tx, [reply.sentBy!], {
      kind: "replyFailed",
      conversationId: reply.conversationId,
      patientId: first?.patientId ?? null,
    });
  }
}
