import { and, eq, inArray } from "drizzle-orm";

import { changeKinds, eventKindTemplates } from "#/lib/outbox.ts";
import type { AffectsAppointments, Notice } from "#/lib/time-ranges.ts";

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
 * Drops the change messages still queued about the appointment
 * `appointmentId`: the patient moved it themselves, so none is news to them.
 */
export function dropChangeMessages(tx: Writer, appointmentId: string) {
  dropQueued(tx, appointmentId, changeKinds);
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
  tx.insert(outboxMessage)
    .values({ kind, templateId: eventKindTemplates[kind], appointmentId, dueAt: Date.now() })
    .run();
}

/** Thrown to roll back a save whose patients nobody has decided about yet. */
class Unasked extends Error {
  constructor(readonly affected: number) {
    super("affectsAppointments");
  }
}

/**
 * Whether to tell the `affected` patients a save sends to the list: what
 * `notice` decided, when it was told this many. Otherwise it throws, for
 * `askingFirst` to roll the save back with the count.
 */
function answerFor(notice: Notice, affected: number): boolean {
  const { tellPatients, affected: told } = notice;
  if (tellPatients === undefined || told !== affected) {
    throw new Unasked(affected);
  }
  return tellPatients;
}

/** The column a time off or a closure keeps of `notice`: the answer, when one was given. */
export function storedAnswer(notice: Notice): { tellPatients?: boolean } {
  return notice.tellPatients === undefined ? {} : { tellPatients: notice.tellPatients };
}

/**
 * Runs `save`, a transaction that settles a time off or a closure with a
 * `Notice`: its result, or the count to ask about when it sent appointments
 * to the list that nobody decided about. The transaction is rolled back then.
 */
export function askingFirst<T>(save: () => T): T | AffectsAppointments {
  try {
    return save();
  } catch (error) {
    if (error instanceof Unasked) {
      return { ok: false, reason: "affectsAppointments", affected: error.affected };
    }
    throw error;
  }
}

/**
 * Runs `change`, a write to working time (time off, a closure, a schedule),
 * and settles the change messages of the appointments of `practitionerIds`
 * (everyone's when `null`) it moved on or off the "to reschedule" list. One
 * sent to the list is told when `tellPatients` says so (a `Notice` must have
 * decided, inside `askingFirst`, when it sends any), and either way an
 * earlier change message about it no longer goes; one back in working time is
 * no longer told it was sent there. Its reminders are the outbox's: none goes
 * while it is on the list.
 */
export function settlingToReschedule<T>(
  tx: Writer,
  practitionerIds: string[] | null,
  tellPatients: boolean | Notice,
  change: () => T,
): T {
  const before = listedIds(tx, practitionerIds);
  const result = change();
  const after = listedIds(tx, practitionerIds);
  const listed = [...after].filter((appointmentId) => !before.has(appointmentId));
  const tell =
    typeof tellPatients === "boolean"
      ? tellPatients
      : listed.length > 0 && answerFor(tellPatients, listed.length);
  for (const appointmentId of listed) {
    if (tell) {
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
