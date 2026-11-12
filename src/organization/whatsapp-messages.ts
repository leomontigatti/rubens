import { and, eq, exists, inArray, isNull, max, ne, not, or } from "drizzle-orm";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappMessageStatus,
  WhatsappStatusUpdate,
  WhatsappTemplateStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import { assistantWaitMs } from "#/lib/assistant.ts";
import { phoneSpellings } from "#/lib/phones.ts";
import { reactionType, takesBack } from "#/lib/reactions.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { guardian, patient } from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { settleFailedReplies } from "#/organization/failed-replies.ts";
import { storeNumberEvent } from "#/organization/whatsapp-limits.ts";
import {
  storeTemplateCategory,
  storeTemplateStatus,
  warnOfRecategorizedTemplate,
  warnOfStoppedTemplate,
} from "#/organization/whatsapp-templates.ts";

// What Meta's webhook brings in (ADR-0010 § The webhook stores, the object's
// alarm acts): the Worker has checked Meta's signature and picked this
// organization from the phone number id; this module only stores, and sets
// the assistant's wait for its turn (`assistant.ts` runs it). Nothing here acts on a
// message or calls a model.

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
export function patientsReachedAt(tx: Writer, phone: string) {
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
 * registered or given this number as a contact joins, and one whose messages
 * went elsewhere leaves, so the number is never taken for theirs.
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

/**
 * Links again every conversation whose number reached `patientId` or may
 * reach them now (their own phone, or their contact guardian's), after a change to their
 * phone or message contact: a practitioner reads what the number says about
 * their appointments without waiting for its next message, and nothing more
 * through a number that no longer reaches the patient.
 */
export function relinkPatient(tx: Writer, patientId: string) {
  const phones = [
    ...tx.select({ phone: patient.phone }).from(patient).where(eq(patient.id, patientId)).all(),
    ...tx
      .select({ phone: guardian.phone })
      .from(guardian)
      .where(and(eq(guardian.patientId, patientId), eq(guardian.messageContact, true)))
      .all(),
  ].flatMap(({ phone }) => phoneSpellings(phone));
  const linked = tx
    .select({ id: conversationPatient.conversationId })
    .from(conversationPatient)
    .where(eq(conversationPatient.patientId, patientId));
  const conversations = tx
    .select({ id: conversation.id, phone: conversation.phone })
    .from(conversation)
    .where(or(inArray(conversation.id, linked), inArray(conversation.phone, phones)))
    .all();
  for (const { id, phone } of conversations) {
    linkPatients(tx, id, phone);
  }
}

/**
 * Leaves the patient's earlier reactions to the same message, replaced or
 * taken back by `by`, for no turn to read: one still waiting is judged as
 * nothing, and a turn reading it meanwhile acts on nothing (`answeredMeanwhile`).
 */
function replaceReactions(
  tx: Writer,
  reaction: { conversationId: string; reactsTo: string; by: string },
) {
  tx.update(whatsappMessage)
    .set({ judgement: "notForPractitioner" })
    .where(
      and(
        eq(whatsappMessage.conversationId, reaction.conversationId),
        eq(whatsappMessage.type, reactionType),
        eq(whatsappMessage.reactsTo, reaction.reactsTo),
        isNull(whatsappMessage.judgement),
        ne(whatsappMessage.id, reaction.by),
      ),
    )
    .run();
}

function storeIncoming(tx: Writer, message: IncomingWhatsappMessage) {
  const conversationId = conversationWith(tx, message.from);
  // A reaction taken back is ignored: no turn reads it, and it opens no window (`lastIncomingAt`).
  const ignored = takesBack(message);
  const stored = tx
    .insert(whatsappMessage)
    .values({
      conversationId,
      whatsappId: message.whatsappId,
      direction: "incoming",
      type: message.type,
      text: message.text,
      payload: message.payload,
      reactsTo: message.reactsTo,
      sentAt: message.sentAt,
      judgement: ignored ? "notForPractitioner" : undefined,
    })
    .onConflictDoNothing({ target: whatsappMessage.whatsappId })
    .returning({ id: whatsappMessage.id })
    .get();
  if (!stored) {
    return { whatsappId: message.whatsappId, alreadyStored: true };
  }
  linkPatients(tx, conversationId, message.from);
  if (message.reactsTo) {
    replaceReactions(tx, { conversationId, reactsTo: message.reactsTo, by: stored.id });
  }
  if (ignored) {
    return { whatsappId: message.whatsappId, alreadyStored: false };
  }
  // Each message restarts the assistant's wait, so a burst gets one turn (`assistant.ts`).
  tx.update(conversation)
    .set({ assistantDueAt: Date.now() + assistantWaitMs })
    .where(eq(conversation.id, conversationId))
    .run();
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
  message: {
    phone: string;
    whatsappId: string;
    type: string;
    text: string;
    payload: string;
    /** For an assistant reply: the communication rules' version it was written under. */
    rulesVersion?: number;
    /** For a member's reply from the inbox: who wrote it. */
    sentBy?: string;
  },
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
      rulesVersion: message.rulesVersion,
      sentBy: message.sentBy,
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
    // A reply whose status just turned failed reopens the handoff it closed.
    settleFailedReplies(
      tx,
      events.statuses
        .filter((update, index) => update.status === "failed" && stored.statuses[index]!.updated)
        .map((update) => update.whatsappId),
    );
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

/** A reaction the patient took back (`takesBack`), in SQL. */
const takenBack = and(
  eq(whatsappMessage.type, reactionType),
  or(isNull(whatsappMessage.text), eq(whatsappMessage.text, "")),
)!;

/** When the patient last wrote in `conversationId`, which opens its window. */
export function lastIncomingAt(database: Writer, conversationId: string) {
  const last = database
    .select({ at: max(whatsappMessage.sentAt) })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
        not(takenBack),
      ),
    )
    .get();
  return last?.at ?? null;
}

/** Whether a member holds `conversationId` (`conversation-holds.ts`), so the assistant stays silent in it and changes nothing. */
export function isHeld(database: Writer, conversationId: string) {
  const found = database
    .select({ heldBy: conversation.heldBy })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get();
  return found?.heldBy != null;
}
