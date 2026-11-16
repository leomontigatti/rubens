import { and, eq, gte, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Database } from "#/organization/database.ts";
import { lateReply, outboxMessage, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// What a reopen template left behind it, as the assistant's turn reads it
// (`late-replies.ts` sends and delivers): whether its replies were withdrawn,
// which the model is told, and whether a tap on its `Ver respuesta` opened the
// window for a reply, which settles the tap with no model call (`button-taps.ts`).

/**
 * The reopen templates among the messages `messageIds` that went, and whose
 * every reply behind them was withdrawn: the patient was told of a reply that
 * will not come.
 */
export function reopensWithdrawn(database: Database, messageIds: string[]): Set<string> {
  if (messageIds.length === 0) {
    return new Set();
  }
  const rows = database
    .select({ messageId: outboxMessage.whatsappMessageId, state: lateReply.state })
    .from(outboxMessage)
    .innerJoin(lateReply, eq(lateReply.reopenId, outboxMessage.id))
    .where(inArray(outboxMessage.whatsappMessageId, messageIds))
    .all();
  const kept = new Set(rows.filter((row) => row.state !== "withdrawn").map((row) => row.messageId));
  return new Set(
    rows.flatMap((row) => (row.messageId && !kept.has(row.messageId) ? [row.messageId] : [])),
  );
}

/**
 * Whether the message Meta knows as `whatsappId` is a reopen template with a
 * reply behind it still waiting, or delivered at `tappedAt` or after: what a
 * tap on its `Ver respuesta` at `tappedAt` opened the window for
 * (`button-taps.ts`). A tap again once that went opens nothing.
 */
export function hasRepliesBehind(database: Database, whatsappId: string, tappedAt: number) {
  const delivered = alias(whatsappMessage, "delivered");
  const behind = database
    .select({ id: lateReply.id })
    .from(lateReply)
    .innerJoin(outboxMessage, eq(outboxMessage.id, lateReply.reopenId))
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, outboxMessage.whatsappMessageId))
    .leftJoin(delivered, eq(delivered.id, lateReply.whatsappMessageId))
    .where(
      and(
        eq(whatsappMessage.whatsappId, whatsappId),
        or(
          eq(lateReply.state, "waiting"),
          and(eq(lateReply.state, "delivered"), gte(delivered.sentAt, tappedAt)),
        ),
      ),
    )
    .get();
  return behind !== undefined;
}
