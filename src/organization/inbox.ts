import { and, asc, count, desc, eq, exists, inArray, like, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { actsForEveryone } from "#/lib/access.ts";
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
import { appointment, patient, practitioner } from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  outboxMessage,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";

// The inbox (ui: "Conversaciones", docs/domain/assistant.md § Inbox), read
// only. Reception and admins read every conversation; a practitioner those
// about their own appointments. A patient's message judged clinical, or not
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
  withheld: null;
}

/** A patient's message the reader may not see, in its place. */
interface WithheldMessage {
  id: string;
  direction: "incoming";
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
function readerOf(database: Database, acting: Acting) {
  const own = ownPractitioner(database, acting);
  let visible: SQL | undefined = undefined;
  if (!actsForEveryone(acting)) {
    visible = own ? aboutAppointmentsOf(database, own.id) : sql`false`;
  }
  return { readsClinical: own?.keepsClinicalRecords === true, visible };
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

const messageColumns = {
  id: whatsappMessage.id,
  conversationId: whatsappMessage.conversationId,
  direction: whatsappMessage.direction,
  sentAt: whatsappMessage.sentAt,
  type: whatsappMessage.type,
  text: whatsappMessage.text,
  status: whatsappMessage.status,
  judgement: whatsappMessage.judgement,
};

type MessageRow = Pick<typeof whatsappMessage.$inferSelect, keyof typeof messageColumns>;

/**
 * Why the reader may not see the message's words: a patient's message judged
 * clinical, or not judged yet, to anyone who does not read clinical content.
 */
function withheldBecause(row: MessageRow, readsClinical: boolean) {
  if (row.direction === "outgoing" || readsClinical || row.judgement === "notClinical") {
    return null;
  }
  return row.judgement === "clinical" ? "clinical" : "notJudged";
}

function asRead(row: MessageRow, readsClinical: boolean): InboxMessage {
  const withheld = withheldBecause(row, readsClinical);
  if (withheld !== null) {
    return { id: row.id, direction: "incoming", sentAt: row.sentAt, withheld };
  }
  const { id, direction, sentAt, type, text, status, judgement } = row;
  return { id, direction, sentAt, type, text, status, judgement, withheld: null };
}

function patientsOf(database: Database, conversationIds: string[]) {
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
    .select(messageColumns)
    .from(whatsappMessage)
    .where(eq(whatsappMessage.conversationId, conversationId))
    // Meta stamps in whole seconds; the row order keeps a batch as it came.
    .orderBy(asc(whatsappMessage.sentAt), asc(sql`${whatsappMessage}.rowid`))
    .all();
  return {
    ok: true,
    conversation: { ...found, patients: patientsOf(database, [found.id]).get(found.id) ?? [] },
    messages: messages.map((row) => asRead(row, reader.readsClinical)),
  };
}
