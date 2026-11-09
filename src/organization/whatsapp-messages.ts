import { and, eq, exists, inArray, not, or } from "drizzle-orm";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappMessageStatus,
  WhatsappStatusUpdate,
  WhatsappTemplateStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import { phoneSpellings } from "#/lib/phones.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { guardian, patient } from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import {
  storeNumberEvent,
  warnOfRecategorizedTemplate,
  warnOfStoppedTemplate,
} from "#/organization/whatsapp-limits.ts";
import { storeTemplateCategory, storeTemplateStatus } from "#/organization/whatsapp-templates.ts";

// What Meta's webhook brings in (ADR-0010 § The webhook stores, the object's
// alarm acts): the Worker has checked Meta's signature and picked this
// organization from the phone number id; this module only stores. Nothing
// here acts on a message or calls a model.

/** The conversation with `phone`, created on its first message. */
function conversationWith(tx: Writer, phone: string): string {
  const created = tx
    .insert(conversation)
    .values({ phone })
    .onConflictDoNothing()
    .returning({ id: conversation.id })
    .get();
  if (created) {
    return created.id;
  }
  return tx
    .select({ id: conversation.id })
    .from(conversation)
    .where(eq(conversation.phone, phone))
    .get()!.id;
}

/**
 * The patients whose messages go to `phone`: through the guardian who is
 * their message contact, or to their own phone when no guardian is.
 */
function patientsReachedAt(tx: Writer, phone: string) {
  const spellings = phoneSpellings(phone);
  const contactGuardian = (withPhone: boolean) =>
    tx
      .select({ id: guardian.id })
      .from(guardian)
      .where(
        and(
          eq(guardian.patientId, patient.id),
          eq(guardian.messageContact, true),
          withPhone ? inArray(guardian.phone, spellings) : undefined,
        ),
      );
  return tx
    .select({ id: patient.id })
    .from(patient)
    .where(
      or(
        exists(contactGuardian(true)),
        and(inArray(patient.phone, spellings), not(exists(contactGuardian(false)))),
      ),
    )
    .all();
}

/**
 * Links the conversation to exactly the patients its number reaches now: one
 * registered or given this number as a contact since its last message joins,
 * and one whose messages went elsewhere since leaves, so the number is never
 * taken for theirs.
 */
function linkPatients(tx: Writer, conversationId: string, phone: string) {
  const patients = patientsReachedAt(tx, phone);
  tx.delete(conversationPatient)
    .where(eq(conversationPatient.conversationId, conversationId))
    .run();
  if (patients.length > 0) {
    tx.insert(conversationPatient)
      .values(patients.map(({ id }) => ({ conversationId, patientId: id })))
      .run();
  }
}

function storeIncoming(tx: Writer, message: IncomingWhatsappMessage) {
  const conversationId = conversationWith(tx, message.from);
  const stored = tx
    .insert(whatsappMessage)
    .values({
      conversationId,
      whatsappId: message.whatsappId,
      direction: "incoming",
      type: message.type,
      text: message.text,
      payload: message.payload,
      sentAt: message.sentAt,
    })
    .onConflictDoNothing({ target: whatsappMessage.whatsappId })
    .returning({ id: whatsappMessage.id })
    .get();
  if (!stored) {
    return { whatsappId: message.whatsappId, alreadyStored: true };
  }
  linkPatients(tx, conversationId, message.from);
  return { whatsappId: message.whatsappId, alreadyStored: false };
}

/** Whether `update` is newer than a message's stored status, by Meta's time, then by stage. */
function isNewer(
  update: WhatsappStatusUpdate,
  stored: { status: WhatsappMessageStatus | null; statusAt: number | null },
) {
  if (stored.status === null || stored.statusAt === null || stored.statusAt < update.at) {
    return true;
  }
  // Meta stamps in whole seconds, so `delivered` and `read` often share one.
  return (
    stored.statusAt === update.at &&
    whatsappMessageStatuses.indexOf(update.status) > whatsappMessageStatuses.indexOf(stored.status)
  );
}

/**
 * The sends each object is waiting on Meta's answer for, and the statuses
 * that arrived meanwhile for a message not stored yet: Meta can report a
 * message before the answer that names it reaches the object.
 */
const sendsByObject = new WeakMap<Database, { inFlight: number; early: WhatsappStatusUpdate[] }>();

function sendsIn(database: Database) {
  let sends = sendsByObject.get(database);
  if (!sends) {
    sends = { inFlight: 0, early: [] };
    sendsByObject.set(database, sends);
  }
  return sends;
}

/**
 * Runs `send`, a call to Meta whose message `storeOutgoing` stores after it;
 * a status for that message that arrives during the call is kept for it.
 */
export async function whileSending<T>(database: Database, send: () => Promise<T>) {
  const sends = sendsIn(database);
  if (sends.inFlight === 0) {
    // What no send stored since: statuses of messages sent outside the outbox.
    sends.early = [];
  }
  sends.inFlight += 1;
  try {
    return await send();
  } finally {
    sends.inFlight -= 1;
  }
}

/**
 * Stores a message the organization's number sent, in the conversation of
 * `phone`, with any status Meta reported for it before it was stored.
 */
export function storeOutgoing(
  database: Database,
  tx: Writer,
  message: { phone: string; whatsappId: string; type: string; text: string; payload: string },
) {
  const stored = tx
    .insert(whatsappMessage)
    .values({
      conversationId: conversationWith(tx, message.phone),
      whatsappId: message.whatsappId,
      direction: "outgoing",
      type: message.type,
      text: message.text,
      payload: message.payload,
      sentAt: Date.now(),
    })
    .returning({ id: whatsappMessage.id })
    .get();
  const sends = sendsIn(database);
  const early = sends.early.filter((update) => update.whatsappId === message.whatsappId);
  sends.early = sends.early.filter((update) => update.whatsappId !== message.whatsappId);
  for (const update of early) {
    storeStatus(database, tx, update);
  }
  return stored;
}

/**
 * Puts `update` on the outgoing message it names, unless that message already
 * has a later status: Meta does not promise to deliver statuses in order. An
 * id no outgoing message has is kept while a send waits on Meta, for the
 * message it may be, and ignored otherwise.
 */
function storeStatus(database: Database, tx: Writer, update: WhatsappStatusUpdate) {
  const target = and(
    eq(whatsappMessage.whatsappId, update.whatsappId),
    eq(whatsappMessage.direction, "outgoing"),
  );
  const stored = tx
    .select({ status: whatsappMessage.status, statusAt: whatsappMessage.statusAt })
    .from(whatsappMessage)
    .where(target)
    .get();
  if (!stored) {
    const sends = sendsIn(database);
    if (sends.inFlight > 0) {
      sends.early.push(update);
    }
    return { whatsappId: update.whatsappId, updated: false };
  }
  if (!isNewer(update, stored)) {
    return { whatsappId: update.whatsappId, updated: false };
  }
  tx.update(whatsappMessage)
    .set({ status: update.status, statusAt: update.at })
    .where(target)
    .run();
  return { whatsappId: update.whatsappId, updated: true };
}

/** Puts `update` on its template, and warns the admins when the version stopped going. */
function storeTemplateUpdate(tx: Writer, update: WhatsappTemplateStatusUpdate) {
  const { changed, ...stored } = storeTemplateStatus(tx, update);
  if (changed) {
    warnOfStoppedTemplate(tx, changed, update);
  }
  return stored;
}

/**
 * Stores one webhook call's events in one transaction: each incoming message
 * once by its WhatsApp id, in its number's conversation, linked to the
 * patients that number is the message contact of; each status update on
 * the outgoing message it names; each template's status and category on its
 * template; and Meta's news about the number (`whatsapp-limits.ts`). A
 * template or a number Meta stopped warns every admin in the same transaction.
 */
export function storeWhatsappEvents(database: Database, events: WhatsappEvents) {
  return database.transaction((tx) => {
    const stored = {
      ok: true as const,
      messages: events.messages.map((message) => storeIncoming(tx, message)),
      statuses: events.statuses.map((update) => storeStatus(database, tx, update)),
      templateStatuses: events.templateStatuses.map((update) => storeTemplateUpdate(tx, update)),
    };
    for (const update of events.templateCategories ?? []) {
      const changed = storeTemplateCategory(tx, update);
      if (changed) {
        warnOfRecategorizedTemplate(tx, changed);
      }
    }
    for (const event of events.numberEvents ?? []) {
      storeNumberEvent(tx, event);
    }
    return stored;
  });
}
