import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import {
  longPauseMs,
  longPauseNote,
  newMessagesMark,
  staffReplyNote,
  withdrawnReplyNote,
  withoutMark,
} from "#/lib/assistant.ts";
import { present } from "#/lib/present.ts";
import { reactionType } from "#/lib/reactions.ts";

import type { TurnMessage } from "#/organization/assistant-model.ts";
import { tapLinesOf } from "#/organization/button-taps.ts";
import type { Database } from "#/organization/database.ts";
import { reopensWithdrawn } from "#/organization/reopen-replies.ts";
import { reactionsOf } from "#/organization/reactions.ts";
import { patient } from "#/organization/schema.ts";
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import { patientsReachedAt } from "#/organization/whatsapp-messages.ts";

// The conversation as the assistant's turn reads it (`assistant.ts`): its
// number and patients, the patient's messages the turn judges, the
// conversation so far, and all of it as the messages the model reads, each
// reaction and tap with the words of the message it answers.

/** The conversation history a turn reads, newest messages last. */
const historyLength = 30;

/**
 * The patients `phone` is the message contact of now, by name: read at the
 * turn, not from the conversation's links, which date from its last message.
 */
export function patientsOf(database: Database, phone: string) {
  return database
    .select({ id: patient.id, firstName: patient.firstName, chosenName: patient.chosenName })
    .from(patient)
    .where(inArray(patient.id, patientsReachedAt(database, phone)))
    .orderBy(asc(patient.id))
    .all()
    .map((one) => ({ id: one.id, firstName: one.chosenName ?? one.firstName }));
}

const messageColumns = {
  id: whatsappMessage.id,
  sentAt: whatsappMessage.sentAt,
  direction: whatsappMessage.direction,
  type: whatsappMessage.type,
  text: whatsappMessage.text,
  reactsTo: whatsappMessage.reactsTo,
  buttonPayload: whatsappMessage.buttonPayload,
  repliesTo: whatsappMessage.repliesTo,
  sentBy: whatsappMessage.sentBy,
};

/**
 * The conversation as a turn reads it: its number, its patients, the
 * messages it judges (every incoming one not judged yet), and the latest
 * others as the conversation so far.
 */
export function readConversation(database: Database, conversationId: string) {
  const { phone, misunderstandings } = present(
    database
      .select({ phone: conversation.phone, misunderstandings: conversation.misunderstandings })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get(),
    "A turn's conversation is stored",
  );
  const inConversation = eq(whatsappMessage.conversationId, conversationId);
  const notJudged = and(
    eq(whatsappMessage.direction, "incoming"),
    isNull(whatsappMessage.judgement),
  );
  const unjudged = database
    .select(messageColumns)
    .from(whatsappMessage)
    .where(and(inConversation, notJudged))
    .orderBy(asc(whatsappMessage.sentAt))
    .all();
  const history = database
    .select(messageColumns)
    .from(whatsappMessage)
    .where(
      and(
        inConversation,
        or(eq(whatsappMessage.direction, "outgoing"), isNotNull(whatsappMessage.judgement)),
      ),
    )
    .orderBy(desc(whatsappMessage.sentAt))
    .limit(historyLength)
    .all()
    .reverse();
  return {
    phone,
    misunderstandings,
    patients: patientsOf(database, phone),
    unjudged,
    history,
    withdrawn: reopensWithdrawn(
      database,
      history.map((message) => message.id),
    ),
    reactions: reactionsOf(database, conversationId),
    taps: tapLinesOf(database, conversationId),
  };
}

export type TurnRead = ReturnType<typeof readConversation>;

/**
 * The messages as the model reads them: the conversation so far, one message
 * per run of the same side, as WhatsApp shows a burst; then the messages the
 * turn judges together as the patient's last, so the judgement is about
 * exactly those and the turn always ends on the patient, after
 * `newMessagesMark`. A patient's own text never carries the mark. A note goes
 * before a message a person at the practice wrote, and where a long pause
 * falls, so a proposal after either restates enough to stand on its own.
 */
export function asTurnMessages(read: TurnRead): TurnMessage[] {
  const contentOf = (message: TurnRead["history"][number]) => {
    const reaction = read.reactions.lines.get(message.id) ?? read.taps.get(message.id);
    if (reaction) {
      return reaction;
    }
    // A voice note nobody could understand has no words.
    const content = message.text || `[${message.type}]`;
    if (message.direction === "incoming") {
      return withoutMark(content);
    }
    const written = message.sentBy ? `${staffReplyNote}\n${content}` : content;
    return read.withdrawn.has(message.id) ? `${written}\n${withdrawnReplyNote}` : written;
  };
  // The latest message so far: the history and the new messages are read
  // apart, so one the practice sent can fall between two new ones.
  let latestSentAt: number | null = null;
  const pauseBefore = (message: TurnRead["history"][number]) => {
    const paused = latestSentAt !== null && message.sentAt - latestSentAt >= longPauseMs;
    latestSentAt = Math.max(latestSentAt ?? message.sentAt, message.sentAt);
    return paused ? `${longPauseNote}\n` : "";
  };
  const messages: TurnMessage[] = [];
  const shown = read.history.filter(
    (message) => message.type !== reactionType || read.reactions.live.has(message.id),
  );
  for (const message of shown) {
    const role = message.direction === "incoming" ? "user" : "assistant";
    const content = `${pauseBefore(message)}${contentOf(message)}`;
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }
  const judged = read.unjudged.map((message) => `${pauseBefore(message)}${contentOf(message)}`);
  return [...messages, { role: "user", content: [newMessagesMark, ...judged].join("\n") }];
}
