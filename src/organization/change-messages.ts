import { and, eq, inArray } from "drizzle-orm";

import { changeKinds } from "#/lib/outbox.ts";

import type { Writer } from "#/organization/database.ts";
import { appointment, patient } from "#/organization/schema.ts";
import { listedIds } from "#/organization/to-reschedule.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";

// The messages for an appointment the organization changed
// (docs/domain/messages.md § To patients): moved or cancelled by staff, or
// sent to the "to reschedule" list. Each is queued in the change's
// transaction, and replaces the one queued for an earlier change that has not
// gone yet, so the patient hears only of the latest. The outbox
// (`src/organization/outbox.ts`) reads the appointment again before it sends.

type ChangeKind = (typeof changeKinds)[number];

/** Drops the queued messages of `kinds` about the appointment `appointmentId`. */
function dropQueued(tx: Writer, appointmentId: string, kinds: readonly ChangeKind[]) {
  tx.update(outboxMessage)
    .set({ state: "dropped", dropReason: "appointmentChanged" })
    .where(
      and(
        eq(outboxMessage.appointmentId, appointmentId),
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, kinds),
      ),
    )
    .run();
}

/**
 * Queues the message `kind` about the appointment `appointmentId`, due at
 * once, when its patient accepts WhatsApp, in place of the change message
 * still queued for it.
 */
export function queueChangeMessage(tx: Writer, appointmentId: string, kind: ChangeKind) {
  dropQueued(tx, appointmentId, changeKinds);
  const changed = tx
    .select({ whatsappConsent: patient.whatsappConsent })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!changed?.whatsappConsent) {
    return;
  }
  tx.insert(outboxMessage).values({ kind, appointmentId, dueAt: Date.now() }).run();
}

/**
 * Runs `change`, a write to working time (time off, a closure, a schedule),
 * and settles the change messages of the appointments of `practitionerIds`
 * (everyone's when `null`) it moved on or off the "to reschedule" list. One
 * sent to the list is told, unless `tellPatients` is off, and either way an
 * earlier change message about it no longer goes; one back in working time is
 * no longer told it was sent there. Its reminders are the outbox's: none goes
 * while it is on the list.
 */
export function settlingToReschedule<T>(
  tx: Writer,
  practitionerIds: string[] | null,
  tellPatients: boolean,
  change: () => T,
): T {
  const before = listedIds(tx, practitionerIds);
  const result = change();
  const after = listedIds(tx, practitionerIds);
  for (const appointmentId of after) {
    if (before.has(appointmentId)) {
      continue;
    }
    if (tellPatients) {
      queueChangeMessage(tx, appointmentId, "appointmentToReschedule");
    } else {
      dropQueued(tx, appointmentId, changeKinds);
    }
  }
  for (const appointmentId of before) {
    if (!after.has(appointmentId)) {
      dropQueued(tx, appointmentId, ["appointmentToReschedule"]);
    }
  }
  return result;
}
