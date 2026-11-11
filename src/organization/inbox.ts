import { and, asc, count, desc, eq, exists, inArray, like, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { actsForEveryone } from "#/lib/access.ts";
import { isWindowOpen, windowClosesAt } from "#/lib/conversation-window.ts";
import { patientName } from "#/lib/patients.ts";
import { parsePhone } from "#/lib/phones.ts";
import { normalizeText, wordsOf } from "#/lib/search-text.ts";
import {
  conversationListSchema,
  conversationPageSize,
  conversationReferenceSchema,
} from "#/lib/whatsapp-messages.ts";
import type {
  ConversationListOptions,
  ConversationReference,
  MessageJudgement,
  WhatsappMessageStatus,
} from "#/lib/whatsapp-messages.ts";

import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { appointment, member, patient, practitioner } from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  handoffRecipient,
  handoff,
  outboxMessage,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { lateRepliesShown, queuedReopenShown } from "#/organization/late-replies.ts";
import type { QueuedReopen, ShownLateReply } from "#/organization/late-replies.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";

// The inbox (ui: "Conversaciones", docs/domain/assistant.md § Inbox), read
// only. Reception and admins read every conversation; a practitioner those
// about their own appointments and those handed to them. A patient's message judged clinical, or not
// judged yet, is withheld from anyone who is not a practitioner who keeps
// clinical records: its words never leave the object for them, only that it
// exists.

/** A message whose words the reader may see. */
interface ShownMessage {
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
  withheld: null;
}

/**
 * A message the reader may not see, in its place: a patient's, or a
 * practitioner's reply to a clinical handoff.
 */
interface WithheldMessage {
  id: string;
  direction: "incoming" | "outgoing";
  sentAt: number;
  /** Why: it waits to be judged, or it was judged clinical. */
  withheld: "notJudged" | "clinical";
}

export type InboxMessage = ShownMessage | WithheldMessage;

export interface ConversationSummary {
  id: string;
  phone: string;
  /** The patients the number is the message contact of, by name. */
  patients: { id: string; name: string }[];
  lastMessage: InboxMessage;
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

/** How `acting` reads the inbox: which conversations, and whether clinical words. */
export function readerOf(database: Database, acting: Acting) {
  const own = ownPractitioner(database, acting);
  let visible: SQL | undefined = undefined;
  if (!actsForEveryone(acting)) {
    visible = own
      ? or(aboutAppointmentsOf(database, own.id), handedTo(database, acting.userId))
      : sql`false`;
  }
  return { readsClinical: own?.keepsClinicalRecords === true, visible };
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

/**
 * The conversations about `practitionerId`'s appointments: with a number
 * that stands for one of their patients, or that a message about one of
 * their appointments went to.
 */
function aboutAppointmentsOf(database: Database, practitionerId: string): SQL {
  const theirs = eq(appointment.practitionerId, practitionerId);
  const throughPatient = database
    .select({ one: conversationPatient.patientId })
    .from(conversationPatient)
    .innerJoin(appointment, eq(appointment.patientId, conversationPatient.patientId))
    .where(and(eq(conversationPatient.conversationId, conversation.id), theirs));
  const throughOutbox = database
    .select({ one: outboxMessage.id })
    .from(outboxMessage)
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, outboxMessage.whatsappMessageId))
    .innerJoin(appointment, eq(appointment.id, outboxMessage.appointmentId))
    .where(and(eq(whatsappMessage.conversationId, conversation.id), theirs));
  return or(exists(throughPatient), exists(throughOutbox))!;
}

export const messageColumns = {
  id: whatsappMessage.id,
  conversationId: whatsappMessage.conversationId,
  direction: whatsappMessage.direction,
  sentAt: whatsappMessage.sentAt,
  type: whatsappMessage.type,
  text: whatsappMessage.text,
  status: whatsappMessage.status,
  judgement: whatsappMessage.judgement,
};

type MessageRow = Pick<typeof whatsappMessage.$inferSelect, keyof typeof messageColumns> & {
  senderName?: string | null;
};

/**
 * Why the reader may not see the message's words, when they do not read
 * clinical content: a patient's message judged clinical, or not judged yet,
 * and an outgoing one judged clinical (a reply to a clinical handoff).
 */
function withheldBecause(row: MessageRow, readsClinical: boolean) {
  if (readsClinical || row.judgement === "notClinical") {
    return null;
  }
  if (row.direction === "outgoing") {
    return row.judgement === "clinical" ? "clinical" : null;
  }
  return row.judgement === "clinical" ? "clinical" : "notJudged";
}

export function asRead(row: MessageRow, readsClinical: boolean): InboxMessage {
  const withheld = withheldBecause(row, readsClinical);
  if (withheld !== null) {
    return { id: row.id, direction: row.direction, sentAt: row.sentAt, withheld };
  }
  const { id, direction, sentAt, type, text, status, judgement } = row;
  const sentBy = row.senderName ?? null;
  return { id, direction, sentAt, type, text, status, judgement, sentBy, withheld: null };
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
 * A page of the conversations `acting` reads, latest message first, each with
 * its latest message, narrowed to what `query` matches.
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
  const shown = and(reader.visible, matching(database, parsed.data.query));
  const { total } = database.select({ total: count() }).from(conversation).where(shown).get() ?? {
    total: 0,
  };
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / conversationPageSize)));
  const latestId = database
    .select({ id: latestMessage.id })
    .from(latestMessage)
    .where(eq(latestMessage.conversationId, conversation.id))
    .orderBy(desc(latestMessage.sentAt), desc(sql`${latestMessage}.rowid`))
    .limit(1);
  // A conversation is created with its first message, so each has a latest.
  const rows = database
    .select({ phone: conversation.phone, ...messageColumns })
    .from(conversation)
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, sql`(${latestId})`))
    .where(shown)
    .orderBy(desc(whatsappMessage.sentAt), desc(sql`${whatsappMessage}.rowid`))
    .limit(conversationPageSize)
    .offset((page - 1) * conversationPageSize)
    .all();
  const patients = patientsOf(
    database,
    rows.map((row) => row.conversationId),
  );
  return {
    ok: true,
    total,
    page,
    conversations: rows.map((row) => ({
      id: row.conversationId,
      phone: row.phone,
      patients: patients.get(row.conversationId) ?? [],
      lastMessage: asRead(row, reader.readsClinical),
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
      conversation: Omit<ConversationSummary, "lastMessage">;
      messages: InboxMessage[];
      /** Who took the conversation over, until when; `null` while the assistant holds it. */
      hold: ConversationHold | null;
      window: ConversationWindow;
      /** The replies written after the window closed that wait for the patient, or never reached them. */
      lateReplies: ShownLateReply[];
      /** The reopen template those replies wait behind, while it is queued. */
      queuedReopen: QueuedReopen | null;
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
    messages: messages.map((row) => asRead(row, reader.readsClinical)),
    hold: holdOf(database, acting, conversationId),
    window: windowOf(lastIncomingAt(database, conversationId)),
    lateReplies: lateRepliesShown(database, conversationId, {
      userId: acting.userId,
      readsClinical: reader.readsClinical,
    }),
    queuedReopen: queuedReopenShown(database, conversationId),
  };
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
