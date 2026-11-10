import { and, asc, eq, inArray, lte, min } from "drizzle-orm";

import type { Database, Writer } from "#/organization/database.ts";
import { notifyOptOut } from "#/organization/notifications.ts";
import { appointment, patient } from "#/organization/schema.ts";
import { optOutHold } from "#/organization/whatsapp-schema.ts";

// The hold an opt-out-looking reply puts on the number (docs/domain/patients.md
// § WhatsApp consent): every patient whose messages go to it gets nothing the
// organization starts until reception turns them off or keeps them, and
// reception and the admins are reminded of each of them daily meanwhile.
// Replies to the patient's own messages are not held. The outbox leaves a held
// patient's messages queued (`outbox.ts`), so keeping them sends what is still
// true then.

const dayMs = 24 * 60 * 60_000;

/**
 * Holds each of `patientIds`, the patients the number reaches now, who still
 * accepts WhatsApp, and notifies reception and the admins of each, for a
 * person to turn their consent off or keep it: in the transaction of the turn
 * that judged the opt-out. Says whether any such patient was found, whose
 * notification the team has then had or gets now.
 */
export function holdForOptOut(tx: Writer, patientIds: string[]) {
  if (patientIds.length === 0) {
    return false;
  }
  const consenting = tx
    .select({ id: patient.id })
    .from(patient)
    .where(and(inArray(patient.id, patientIds), eq(patient.whatsappConsent, true)))
    .orderBy(asc(patient.id))
    .all();
  const remindAt = Date.now() + dayMs;
  for (const { id } of consenting) {
    notifyOptOut(tx, id, "optOut");
    tx.insert(optOutHold).values({ patientId: id, remindAt }).onConflictDoNothing().run();
  }
  return consenting.length > 0;
}

/** Lifts `patientId`'s hold, once a person decided on them; says whether there was one. */
export function liftOptOutHold(tx: Writer, patientId: string) {
  const lifted = tx
    .delete(optOutHold)
    .where(eq(optOutHold.patientId, patientId))
    .returning({ patientId: optOutHold.patientId })
    .get();
  return lifted !== undefined;
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

/** Reminds reception and the admins of every held patient whose day has passed: the object's alarm. */
export function remindHeldOptOuts(database: Database) {
  const now = Date.now();
  database.transaction((tx) => {
    const due = tx
      .select({ patientId: optOutHold.patientId })
      .from(optOutHold)
      .where(lte(optOutHold.remindAt, now))
      .all();
    for (const { patientId } of due) {
      notifyOptOut(tx, patientId, "optOutReminder");
      tx.update(optOutHold)
        .set({ remindAt: now + dayMs })
        .where(eq(optOutHold.patientId, patientId))
        .run();
    }
  });
}
