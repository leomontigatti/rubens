import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { liveReactions, reactionLine, reactionType, takesBack } from "#/lib/reactions.ts";

import type { Database } from "#/organization/database.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The patient's reactions as a turn reads them (`assistant.ts`): each with
// the words of the message it reacts to. The conversation so far holds only
// the reaction a message still shows, so one replaced or taken back is not
// read again; storing a reaction judges the ones it replaced
// (`whatsapp-messages.ts`), so a turn's new messages hold none of them.

/** The reactions of `conversationId`: which still show, and the words of the messages they react to. */
export function reactionsOf(database: Database, conversationId: string) {
  const inConversation = eq(whatsappMessage.conversationId, conversationId);
  const isReaction = and(inConversation, eq(whatsappMessage.type, reactionType));
  const reactions = database
    .select({
      id: whatsappMessage.id,
      type: whatsappMessage.type,
      reactsTo: whatsappMessage.reactsTo,
      text: whatsappMessage.text,
    })
    .from(whatsappMessage)
    .where(isReaction)
    .orderBy(asc(whatsappMessage.sentAt), asc(sql`${whatsappMessage}.rowid`))
    .all();
  const shown = reactions.filter((one) => !takesBack(one));
  const reacted = alias(whatsappMessage, "reacted");
  const targets = database
    .select({ whatsappId: reacted.whatsappId, text: reacted.text })
    .from(reacted)
    .where(
      and(
        eq(reacted.conversationId, conversationId),
        inArray(
          reacted.whatsappId,
          database.select({ id: whatsappMessage.reactsTo }).from(whatsappMessage).where(isReaction),
        ),
      ),
    )
    .all();
  const words = new Map(targets.map((target) => [target.whatsappId, target.text || null]));
  return {
    /** Each reaction but those taking one back, as the model reads it. */
    lines: new Map(
      shown.map((one) => [one.id, reactionLine(one.text!, words.get(one.reactsTo!) ?? null)]),
    ),
    /** The reactions their messages still show: the conversation so far reads only these. */
    live: new Set([...liveReactions(reactions).values()].map((one) => one.id)),
  };
}
