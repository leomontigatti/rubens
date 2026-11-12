import { and, asc, count, desc, eq, exists, inArray, like, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { actsForEveryone } from "#/lib/access.ts";
import { messageMediaOf } from "#/lib/message-media.ts";
import type { MessageMedia } from "#/lib/message-media.ts";
import { isWindowOpen, windowClosesAt } from "#/lib/conversation-window.ts";
import { patientName } from "#/lib/patients.ts";
import { parsePhone } from "#/lib/phones.ts";
import { liveReactions, reactionType } from "#/lib/reactions.ts";
import { normalizeText, wordsOf } from "#/lib/search-text.ts";
import {
  conversationListSchema,
  conversationPageSize,
  conversationReferenceSchema,
} from "#/lib/whatsapp-messages.ts";
import type {
  ConversationListOptions,
  ConversationReference,
  MediaType,
  MessageJudgement,
  WhatsappMessageStatus,
} from "#/lib/whatsapp-messages.ts";
import type { HandoffReason } from "#/lib/handoffs.ts";

import type { Database } from "#/organization/database.ts";
import { recipientsByHandoff } from "#/organization/handoffs.ts";
import type { Acting } from "#/organization/members.ts";
import { member, patient, practitioner } from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  handoffRecipient,
  handoff,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import {
  lateRepliesShown,
  queuedReopenShown,
  withdrawnRepliesShown,
} from "#/organization/late-replies.ts";
import type { QueuedReopen, ShownLateReply, WithdrawnReply } from "#/organization/late-replies.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";
import { optOutsShown } from "#/organization/opt-out-holds.ts";
import type { ShownOptOut } from "#/organization/opt-out-holds.ts";

// The inbox (ui: "Conversaciones", docs/domain/assistant.md § Inbox), read
// only. Reception and admins read every conversation; a practitioner only
// those handed to them, not every conversation of their patients. Whoever reads a
// conversation reads every message in it: the clinical record is what stays
// with the practitioners (ADR-0013).

/** A message of a conversation, as the inbox shows it. */
export interface InboxMessage {
  id: string;
  direction: "incoming" | "outgoing";
  sentAt: number;
  /** Meta's message type: `text`, `template`, `image`, … */
  type: string;
  text: string | null;
  /** An outgoing message's latest status at Meta. */
  status: WhatsappMessageStatus | null;
  judgement: MessageJudgement | null;
  /** The member who wrote an outgoing reply from the inbox, by name; `null` for the assistant's and the templates. */
  sentBy: string | null;
  /** A patient's voice note, photo, video or file, which the inbox opens from Meta; `null` for words alone. */
  media: MessageMedia | null;
  /** The patient's reaction shown under it, its emoji; `null` for none. */
  reaction: string | null;
}

/** An open handoff, as the inbox names it: why, and to whom. */
export interface ListedHandoff {
  id: string;
  reason: HandoffReason;
  /** Whether it needs the practitioner, rather than reception. */
  forPractitioner: boolean;
  /** For a `media` handoff, what the patient sent. */
  media: MediaType[];
  /** Who it went to, by name. */
  recipients: string[];
}

export interface ConversationSummary {
  id: string;
  phone: string;
  /** The patients the number is the message contact of, by name. */
  patients: { id: string; name: string }[];
  lastMessage: InboxMessage;
  /** Its open handoffs, oldest first. */
  handoffs: ListedHandoff[];
}

/** The open handoffs of each of `conversationIds`, oldest first. */
function openHandoffsByConversation(database: Database, conversationIds: string[]) {
  const rows =
    conversationIds.length === 0
      ? []
      : database
          .select({
            id: handoff.id,
            conversationId: handoff.conversationId,
            reason: handoff.reason,
            forPractitioner: handoff.forPractitioner,
            detail: handoff.detail,
          })
          .from(handoff)
          .where(and(inArray(handoff.conversationId, conversationIds), eq(handoff.state, "open")))
          .orderBy(asc(handoff.createdAt), asc(sql`${handoff}.rowid`))
          .all();
  const recipients = recipientsByHandoff(
    database,
    rows.map((row) => row.id),
  );
  const byConversation = new Map<string, ListedHandoff[]>();
  for (const { conversationId, detail, ...row } of rows) {
    const listed = { ...row, media: detail?.media ?? [], recipients: recipients.get(row.id) ?? [] };
    byConversation.set(conversationId, [...(byConversation.get(conversationId) ?? []), listed]);
  }
  return byConversation;
}

/** Whether the conversation has an open handoff. */
function withOpenHandoff(database: Database): SQL {
  return exists(
    database
      .select({ one: handoff.id })
      .from(handoff)
      .where(and(eq(handoff.conversationId, conversation.id), eq(handoff.state, "open"))),
  );
}

function ownPractitioner(database: Database, acting: Acting) {
  if (!acting.roles.includes("practitioner")) {
    return undefined;
  }
  return database
    .select({ id: practitioner.id, keepsClinicalRecords: practitioner.keepsClinicalRecords })
    .from(practitioner)
    .where(eq(practitioner.memberId, acting.userId))
    .get();
}

/**
 * How `acting` reads the inbox: which conversations, and whether they keep
 * clinical records, so answer a handoff to the practitioner.
 */
export function readerOf(database: Database, acting: Acting) {
  const own = ownPractitioner(database, acting);
  let visible: SQL | undefined = undefined;
  if (!actsForEveryone(acting)) {
    visible = own ? handedTo(database, acting.userId) : sql`false`;
  }
  return { keepsRecords: own?.keepsClinicalRecords === true, visible };
}

/** The conversations a handoff went to `memberId` in. */
function handedTo(database: Database, memberId: string): SQL {
  return exists(
    database
      .select({ one: handoffRecipient.handoffId })
      .from(handoffRecipient)
      .innerJoin(handoff, eq(handoff.id, handoffRecipient.handoffId))
      .where(
        and(eq(handoff.conversationId, conversation.id), eq(handoffRecipient.memberId, memberId)),
      ),
  );
}

export const messageColumns = {
  id: whatsappMessage.id,
  conversationId: whatsappMessage.conversationId,
  direction: whatsappMessage.direction,
  sentAt: whatsappMessage.sentAt,
  type: whatsappMessage.type,
  text: whatsappMessage.text,
  whatsappId: whatsappMessage.whatsappId,
  reactsTo: whatsappMessage.reactsTo,
  status: whatsappMessage.status,
  judgement: whatsappMessage.judgement,
  payload: whatsappMessage.payload,
};

type MessageRow = Pick<typeof whatsappMessage.$inferSelect, keyof typeof messageColumns> & {
  senderName?: string | null;
};

export function asRead(row: MessageRow, reaction: string | null = null): InboxMessage {
  const { id, direction, sentAt, type, text, status, judgement } = row;
  return {
    id,
    direction,
    sentAt,
    type,
    text,
    status,
    judgement,
    sentBy: row.senderName ?? null,
    media: messageMediaOf(row),
    reaction,
  };
}

export function patientsOf(database: Database, conversationIds: string[]) {
  const rows =
    conversationIds.length === 0
      ? []
      : database
          .select({
            conversationId: conversationPatient.conversationId,
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            chosenName: patient.chosenName,
          })
          .from(conversationPatient)
          .innerJoin(patient, eq(patient.id, conversationPatient.patientId))
          .where(inArray(conversationPatient.conversationId, conversationIds))
          .orderBy(asc(patient.lastName), asc(patient.firstName))
          .all();
  const byConversation = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const list = byConversation.get(row.conversationId) ?? [];
    list.push({ id: row.id, name: patientName(row) });
    byConversation.set(row.conversationId, list);
  }
  return byConversation;
}

const latestMessage = alias(whatsappMessage, "latest_message");

const searchWordLimit = 10;

/**
 * The conversations a search matches: every word of it in the names of a
 * patient the number stands for, or its digits in the number.
 */
function matching(database: Database, query: string): SQL | undefined {
  if (query === "") {
    return undefined;
  }
  // Each word is a bound parameter, and the object's SQLite takes at most 100 a query.
  const words = wordsOf(normalizeText(query)).slice(0, searchWordLimit);
  const padded = sql`' ' || ${patient.searchName} || ' '`;
  const byName = database
    .select({ one: conversationPatient.patientId })
    .from(conversationPatient)
    .innerJoin(patient, eq(patient.id, conversationPatient.patientId))
    .where(
      and(
        eq(conversationPatient.conversationId, conversation.id),
        ...words.map((word) => sql`${padded} like ${`%${word}%`}`),
      ),
    );
  const digits = query.replace(/[\s.()+-]/g, "");
  const phone = parsePhone(query);
  // A query with nothing to match by, such as a lone `+`, matches nothing.
  return (
    or(
      words.length > 0 ? exists(byName) : undefined,
      /^\d+$/.test(digits) ? like(conversation.phone, `%${digits}%`) : undefined,
      phone.ok ? eq(conversation.phone, phone.phone) : undefined,
    ) ?? sql`false`
  );
}

/**
 * A page of the conversations `acting` reads, those with an open handoff
 * first, then latest message first, each with its latest message and open
 * handoffs, narrowed to what `query` matches and, when `withHandoff`, to
 * those with an open handoff.
 */
export function listConversations(
  database: Database,
  acting: Acting,
  options: ConversationListOptions,
):
  | { ok: true; conversations: ConversationSummary[]; total: number; page: number }
  | { ok: false; reason: "invalidInput" } {
  const parsed = conversationListSchema.safeParse(options);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const reader = readerOf(database, acting);
  const shown = and(
    reader.visible,
    matching(database, parsed.data.query),
    parsed.data.withHandoff ? withOpenHandoff(database) : undefined,
  );
  const { total } = database.select({ total: count() }).from(conversation).where(shown).get() ?? {
    total: 0,
  };
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / conversationPageSize)));
  const latestId = database
    .select({ id: latestMessage.id })
    .from(latestMessage)
    // A reaction is shown under its message, never as the conversation's latest.
    .where(
      and(eq(latestMessage.conversationId, conversation.id), ne(latestMessage.type, reactionType)),
    )
    .orderBy(desc(latestMessage.sentAt), desc(sql`${latestMessage}.rowid`))
    .limit(1);
  // A conversation is created with its first message, so each has a latest.
  const rows = database
    .select({ phone: conversation.phone, ...messageColumns })
    .from(conversation)
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, sql`(${latestId})`))
    .where(shown)
    .orderBy(
      desc(withOpenHandoff(database)),
      desc(whatsappMessage.sentAt),
      desc(sql`${whatsappMessage}.rowid`),
    )
    .limit(conversationPageSize)
    .offset((page - 1) * conversationPageSize)
    .all();
  const conversationIds = rows.map((row) => row.conversationId);
  const patients = patientsOf(database, conversationIds);
  const handoffs = openHandoffsByConversation(database, conversationIds);
  return {
    ok: true,
    total,
    page,
    conversations: rows.map((row) => ({
      id: row.conversationId,
      phone: row.phone,
      patients: patients.get(row.conversationId) ?? [],
      lastMessage: asRead(row),
      handoffs: handoffs.get(row.conversationId) ?? [],
    })),
  };
}

/**
 * One conversation with its messages, oldest first, as `acting` reads it; one
 * they may not read is not found.
 */
export function readConversation(
  database: Database,
  acting: Acting,
  input: ConversationReference,
):
  | {
      ok: true;
      conversation: Omit<ConversationSummary, "lastMessage" | "handoffs">;
      messages: InboxMessage[];
      /** Who took the conversation over, until when; `null` while the assistant holds it. */
      hold: ConversationHold | null;
      window: ConversationWindow;
      /** The replies written after the window closed that wait for the patient, or never reached them. */
      lateReplies: ShownLateReply[];
      /** The reopen template those replies wait behind, while it is queued. */
      queuedReopen: QueuedReopen | null;
      /** The late replies their writers withdrew, shown as a trace without their words. */
      withdrawnReplies: WithdrawnReply[];
      /** The patients each opt-out-looking reply held, decided or not, under that reply. */
      optOuts: ShownOptOut[];
    }
  | { ok: false; reason: "invalidInput" | "notFound" } {
  const parsed = conversationReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { conversationId } = parsed.data;
  const reader = readerOf(database, acting);
  const found = database
    .select({ id: conversation.id, phone: conversation.phone })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), reader.visible))
    .get();
  if (!found) {
    return { ok: false, reason: "notFound" };
  }
  const messages = database
    .select({ ...messageColumns, senderName: member.name })
    .from(whatsappMessage)
    .leftJoin(member, eq(member.userId, whatsappMessage.sentBy))
    .where(eq(whatsappMessage.conversationId, conversationId))
    // Meta stamps in whole seconds; the row order keeps a batch as it came.
    .orderBy(asc(whatsappMessage.sentAt), asc(sql`${whatsappMessage}.rowid`))
    .all();
  return {
    ok: true,
    conversation: { ...found, patients: patientsOf(database, [found.id]).get(found.id) ?? [] },
    messages: withReactions(messages),
    hold: holdOf(database, acting, conversationId),
    window: windowOf(lastIncomingAt(database, conversationId)),
    lateReplies: lateRepliesShown(database, conversationId, acting.userId),
    queuedReopen: queuedReopenShown(database, conversationId),
    withdrawnReplies: withdrawnRepliesShown(database, conversationId),
    optOuts: optOutsShown(database, conversationId),
  };
}

/**
 * The messages as the chat shows them: each with the patient's reaction to it
 * under it, and no reaction as a message of its own unless the one it reacts
 * to is not stored.
 */
function withReactions(rows: MessageRow[]) {
  const live = liveReactions(rows);
  const stored = new Set(rows.map((row) => row.whatsappId));
  return rows
    .filter(
      (row) =>
        row.type !== reactionType ||
        (!stored.has(row.reactsTo!) && live.get(row.reactsTo!) === row),
    )
    .map((row) => asRead(row, live.get(row.whatsappId)?.text ?? null));
}

/** A conversation's window, read now: whether a free-form reply may go, and when it closes. */
export interface ConversationWindow {
  open: boolean;
  /** `null` when the patient never wrote, so it never opened. */
  closesAt: number | null;
}

function windowOf(lastIncomingAt: number | null): ConversationWindow {
  return {
    open: isWindowOpen(lastIncomingAt, Date.now()),
    closesAt: windowClosesAt(lastIncomingAt),
  };
}

export interface ConversationHold {
  /** The member holding it, by name. */
  holder: string;
  /** When it goes back to the assistant on its own. */
  heldUntil: number;
  /** Whether the reader holds it. */
  mine: boolean;
}

/** Who holds `conversationId` and until when, by name, as `acting` reads it; `null` while the assistant does. */
function holdOf(
  database: Database,
  acting: Acting,
  conversationId: string,
): ConversationHold | null {
  const row = database
    .select({ heldBy: conversation.heldBy, heldUntil: conversation.heldUntil, name: member.name })
    .from(conversation)
    .innerJoin(member, eq(member.userId, conversation.heldBy))
    .where(eq(conversation.id, conversationId))
    .get();
  if (!row?.heldBy || row.heldUntil === null) {
    return null;
  }
  return { holder: row.name, heldUntil: row.heldUntil, mine: row.heldBy === acting.userId };
}
