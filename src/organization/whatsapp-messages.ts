import { and, eq, exists, inArray, not, or } from "drizzle-orm";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappMessageStatus,
  WhatsappStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import { phoneSpellings } from "#/lib/phones.ts";

import type { Database, Writer } from "#/organization/database.ts";
import {
  conversation,
  conversationPatient,
  guardian,
  patient,
  whatsappMessage,
} from "#/organization/schema.ts";
import { storeTemplateStatus } from "#/organization/whatsapp-templates.ts";

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
 * Puts `update` on the outgoing message it names, unless that message already
 * has a later status: Meta does not promise to deliver statuses in order. An
 * id no outgoing message has is ignored.
 */
function storeStatus(tx: Writer, update: WhatsappStatusUpdate) {
  const target = and(
    eq(whatsappMessage.whatsappId, update.whatsappId),
    eq(whatsappMessage.direction, "outgoing"),
  );
  const stored = tx
    .select({ status: whatsappMessage.status, statusAt: whatsappMessage.statusAt })
    .from(whatsappMessage)
    .where(target)
    .get();
  if (!stored || !isNewer(update, stored)) {
    return { whatsappId: update.whatsappId, updated: false };
  }
  tx.update(whatsappMessage)
    .set({ status: update.status, statusAt: update.at })
    .where(target)
    .run();
  return { whatsappId: update.whatsappId, updated: true };
}

/**
 * Stores one webhook call's events in one transaction: each incoming message
 * once by its WhatsApp id, in its number's conversation, linked to the
 * patients that number is the message contact of; each status update on
 * the outgoing message it names; and each template status on its template.
 */
export function storeWhatsappEvents(database: Database, events: WhatsappEvents) {
  return database.transaction((tx) => ({
    ok: true as const,
    messages: events.messages.map((message) => storeIncoming(tx, message)),
    statuses: events.statuses.map((update) => storeStatus(tx, update)),
    templateStatuses: events.templateStatuses.map((update) => storeTemplateStatus(tx, update)),
  }));
}
