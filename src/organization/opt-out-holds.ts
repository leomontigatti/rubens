import { and, asc, eq, inArray, lte, min } from "drizzle-orm";

import { patientName } from "#/lib/patients.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { notifyOptOut, remindOptOut, resolveOptOut } from "#/organization/notifications.ts";
import { appointment, member, optOutDecision, patient } from "#/organization/schema.ts";
import { optOutHold, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import { patientsReachedAt } from "#/organization/whatsapp-messages.ts";

// The hold an opt-out-looking reply puts on the number (docs/domain/patients.md
// § WhatsApp consent): every patient whose messages go to it gets nothing the
// organization starts until reception turns them off or keeps them, and
// reception and the admins are reminded of each of them daily meanwhile, on
// the one notification of each. It is decided under the reply in the
// conversation, or on the patient's record, either acting on the same hold.
// Replies to the patient's own messages are not held. The outbox leaves a held
// patient's messages queued (`outbox.ts`), so keeping them sends what is still
// true then.

const dayMs = 24 * 60 * 60_000;

/**
 * Holds each patient `phone` reaches now who still accepts WhatsApp, under
 * `messageId`, the reply that asked, and notifies reception and the admins of
 * each newly held, for a person to turn their consent off or keep it: in the transaction of the turn that judged the
 * opt-out. A patient held already keeps their hold and its notification.
 * Returns those patients, whose notification the team has then had or gets now.
 */
export function holdForOptOut(tx: Writer, phone: string, messageId: string) {
  const consenting = tx
    .select({ id: patient.id })
    .from(patient)
    .where(
      and(inArray(patient.id, patientsReachedAt(tx, phone)), eq(patient.whatsappConsent, true)),
    )
    .orderBy(asc(patient.id))
    .all();
  const remindAt = Date.now() + dayMs;
  for (const { id } of consenting) {
    const held = tx
      .insert(optOutHold)
      .values({ patientId: id, messageId, remindAt })
      .onConflictDoNothing()
      .returning({ patientId: optOutHold.patientId })
      .get();
    if (held) {
      notifyOptOut(tx, id, messageId);
    }
  }
  return consenting.map(({ id }) => id);
}

/**
 * Lifts `patientId`'s hold, once `acting` decided to keep them or turn them
 * off, which resolves everyone's notification and is shown under the reply
 * that held them; says whether there was one.
 */
export function liftOptOutHold(tx: Writer, acting: Acting, patientId: string, kept: boolean) {
  const lifted = tx
    .delete(optOutHold)
    .where(eq(optOutHold.patientId, patientId))
    .returning({ messageId: optOutHold.messageId })
    .get();
  if (!lifted) {
    return false;
  }
  resolveOptOut(tx, patientId);
  if (lifted.messageId !== null) {
    tx.insert(optOutDecision)
      .values({
        messageId: lifted.messageId,
        patientId,
        kept,
        decidedBy: acting.userId,
        decidedAt: Date.now(),
      })
      .run();
  }
  return true;
}

/** Whether `patientId` is held under `messageId`, so a decision there still answers it. */
export function isHeldUnder(tx: Writer, patientId: string, messageId: string) {
  const held = tx
    .select({ patientId: optOutHold.patientId })
    .from(optOutHold)
    .where(and(eq(optOutHold.patientId, patientId), eq(optOutHold.messageId, messageId)))
    .get();
  return held !== undefined;
}

/** An opt-out under its reply in the conversation: a patient it held, and how a person decided, if they did. */
export interface ShownOptOut {
  messageId: string;
  patient: { id: string; name: string };
  /** `null` while the patient is held. */
  decision: { kept: boolean; by: string; at: number } | null;
}

const patientColumns = {
  patientId: patient.id,
  firstName: patient.firstName,
  lastName: patient.lastName,
  chosenName: patient.chosenName,
};

/** The opt-outs under `conversationId`'s replies, held or decided, by patient name. */
export function optOutsShown(database: Database, conversationId: string): ShownOptOut[] {
  const inConversation = eq(whatsappMessage.conversationId, conversationId);
  const held = database
    .select({ messageId: whatsappMessage.id, ...patientColumns })
    .from(optOutHold)
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, optOutHold.messageId))
    .innerJoin(patient, eq(patient.id, optOutHold.patientId))
    .where(inConversation)
    .all()
    .map(({ messageId, ...row }) => ({ messageId, row, decision: null }));
  const decided = database
    .select({
      messageId: optOutDecision.messageId,
      kept: optOutDecision.kept,
      by: member.name,
      at: optOutDecision.decidedAt,
      ...patientColumns,
    })
    .from(optOutDecision)
    .innerJoin(whatsappMessage, eq(whatsappMessage.id, optOutDecision.messageId))
    .innerJoin(patient, eq(patient.id, optOutDecision.patientId))
    .innerJoin(member, eq(member.userId, optOutDecision.decidedBy))
    .where(inConversation)
    .all()
    .map(({ messageId, kept, by, at, ...row }) => ({ messageId, row, decision: { kept, by, at } }));
  return [...held, ...decided]
    .map(({ messageId, row, decision }) => ({
      messageId,
      patient: { id: row.patientId, name: patientName(row) },
      decision,
    }))
    .sort((first, second) => first.patient.name.localeCompare(second.patient.name, "es"));
}

/** When `patientId` was held, or `null` while nobody waits on a decision about them. */
export function optOutPendingSince(database: Writer, patientId: string) {
  const held = database
    .select({ createdAt: optOutHold.createdAt })
    .from(optOutHold)
    .where(eq(optOutHold.patientId, patientId))
    .get();
  return held?.createdAt ?? null;
}

/** The appointments of held patients, whose queued messages wait: a subquery for the outbox. */
export function heldAppointmentIds(database: Writer) {
  return database
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      inArray(
        appointment.patientId,
        database.select({ id: optOutHold.patientId }).from(optOutHold),
      ),
    );
}

/** When the next daily reminder about a held patient goes, or `null` with none held. */
export function nextOptOutReminderAlarm(database: Database) {
  return (
    database
      .select({ at: min(optOutHold.remindAt) })
      .from(optOutHold)
      .get()?.at ?? null
  );
}

/**
 * Reminds reception and the admins of every held patient whose day has
 * passed, on each one's notification of them: the object's alarm.
 */
export function remindHeldOptOuts(database: Database) {
  const now = Date.now();
  database.transaction((tx) => {
    const due = tx
      .select({ patientId: optOutHold.patientId, messageId: optOutHold.messageId })
      .from(optOutHold)
      .where(lte(optOutHold.remindAt, now))
      .all();
    for (const { patientId, messageId } of due) {
      remindOptOut(tx, patientId, messageId);
      tx.update(optOutHold)
        .set({ remindAt: now + dayMs })
        .where(eq(optOutHold.patientId, patientId))
        .run();
    }
  });
}
