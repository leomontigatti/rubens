import { and, asc, eq, gt, inArray, isNull, lte, min, notInArray, or } from "drizzle-orm";

import { retryAt } from "#/lib/outbox.ts";
import type { OutboxKind } from "#/lib/outbox.ts";
import { attendedTimings } from "#/lib/template-timing.ts";
import type { TimingKind } from "#/lib/template-timing.ts";
import { fillTemplate, templateValues } from "#/lib/template-filling.ts";
import { metaTemplateName } from "#/lib/whatsapp-templates.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError, TemplateMessage, WhatsappCloud } from "#/organization/graph-api.ts";
import {
  appointment,
  guardian,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import { outboxMessage, whatsappTemplate } from "#/organization/whatsapp-schema.ts";
import { reopenToSend } from "#/organization/late-replies.ts";
import { organizationName } from "#/organization/members.ts";
import { heldAppointmentIds } from "#/organization/opt-out-holds.ts";
import { requeueBefore, upcomingStatuses } from "#/organization/template-messages.ts";
import { isToReschedule } from "#/organization/to-reschedule.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import { storeOutgoing, whileSending } from "#/organization/whatsapp-messages.ts";
import { approvedVersion } from "#/organization/whatsapp-templates.ts";
import type { Job } from "#/organization/jobs.ts";

// The outbox (`src/lib/outbox.ts`): messages to patients, queued in the
// transaction that changes their appointment and sent by the object's alarm
// once due. A queued message is read again when it goes: what it says comes
// from the appointment as it is then, and one no longer true or no longer
// allowed is dropped. Nothing here logs a patient's data or Meta's token.
//
// A message goes at least once: if the object stops between Meta accepting it
// and the row being marked sent, the next alarm sends it again. A `sending`
// state written before the call would not close that window, only move it:
// the object restarting cannot tell whether Meta took a message left
// `sending`, so it would have to send it again (the same duplicate) or drop
// it (a reminder silently lost). The window is one Graph API round trip, open
// only when the object is evicted mid-send, and its cost is one repeated
// message the patient can see.

/**
 * Drops every queued message to `patientId`: in the transaction that turns
 * their WhatsApp consent off, so nothing waiting for a template or a hold of
 * Meta's goes once they are usable again (docs/domain/messages.md § To patients).
 */
export function dropQueuedForPatient(tx: Writer, patientId: string) {
  const theirs = tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(eq(appointment.patientId, patientId));
  tx.update(outboxMessage)
    .set({ state: "dropped", dropReason: "noConsent" })
    .where(and(eq(outboxMessage.state, "queued"), inArray(outboxMessage.appointmentId, theirs)))
    .run();
}

/**
 * Queues again the messages still ahead of `patientId`'s upcoming
 * appointments: in the transaction that turns their WhatsApp consent back
 * on, since turning it off dropped them (`dropQueuedForPatient`).
 */
export function requeueForPatient(tx: Writer, patientId: string) {
  const upcoming = tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.patientId, patientId),
        inArray(appointment.status, upcomingStatuses),
        gt(appointment.startsAt, Date.now()),
      ),
    )
    .all();
  for (const { id } of upcoming) {
    requeueBefore(tx, id);
  }
}

/**
 * The templates whose messages can go now: Meta's settings are complete, the
 * number is not held (`whatsapp-limits.ts`), and the template has an approved
 * utility version: a subquery, since an organization may have more of them
 * than one statement binds; `null` when none can go.
 */
function sendableTemplates(database: Database, cloud: WhatsappCloud) {
  if (cloud.missingSetting() || activeHold(database, Date.now())) {
    return null;
  }
  return database
    .select({ id: whatsappTemplate.templateId })
    .from(whatsappTemplate)
    .where(and(eq(whatsappTemplate.status, "approved"), eq(whatsappTemplate.category, "utility")));
}

/**
 * The queued messages that may go now as far as their patient goes: none to a
 * patient an opt-out-looking reply holds (`opt-out-holds.ts`). The reopen
 * template answers the patient, so it has no appointment and is never held.
 */
function notHeldByOptOut(database: Database) {
  return or(
    isNull(outboxMessage.appointmentId),
    notInArray(outboxMessage.appointmentId, heldAppointmentIds(database)),
  );
}

/**
 * When the object's alarm should next fire: at the earliest queued message
 * that can go, or `null` when none can. A message waiting for its template's
 * approval, for Meta's settings or for an opt-out's decision is left out, so the alarm does not spin;
 * one waiting on a hold of the number, until the hold ends, if it ends by time.
 */
function nextOutboxAlarm(database: Database, cloud: WhatsappCloud): number | null {
  const hold = activeHold(database, Date.now());
  if (hold) {
    const anyQueued = database
      .select({ id: outboxMessage.id })
      .from(outboxMessage)
      .where(eq(outboxMessage.state, "queued"))
      .get();
    return anyQueued ? hold.until : null;
  }
  const templates = sendableTemplates(database, cloud);
  if (!templates) {
    return null;
  }
  const next = database
    .select({ dueAt: min(outboxMessage.dueAt) })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.templateId, templates),
        notHeldByOptOut(database),
      ),
    )
    .get();
  return next?.dueAt ?? null;
}

/** A queued message, with its appointment as it is now and the number messages to its patient go to. */
function readQueued(database: Database, id: string) {
  return database
    .select({
      id: outboxMessage.id,
      kind: outboxMessage.kind,
      templateId: outboxMessage.templateId,
      timing: outboxMessage.timing,
      appointmentId: appointment.id,
      status: appointment.status,
      cancelledBy: appointment.cancelledBy,
      startsAt: appointment.startsAt,
      whatsappConsent: patient.whatsappConsent,
      firstName: patient.firstName,
      chosenName: patient.chosenName,
      patientPhone: patient.phone,
      guardianPhone: guardian.phone,
      practitionerName: practitioner.displayName,
      officeName: office.name,
      officeAddress: office.address,
      timeZone: office.timeZone,
    })
    .from(outboxMessage)
    .innerJoin(appointment, eq(appointment.id, outboxMessage.appointmentId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .leftJoin(guardian, and(eq(guardian.patientId, patient.id), eq(guardian.messageContact, true)))
    .where(and(eq(outboxMessage.id, id), eq(outboxMessage.state, "queued")))
    .get();
}

type Queued = NonNullable<ReturnType<typeof readQueued>>;

function isAttendedTiming(timing: TimingKind | null) {
  return timing !== null && (attendedTimings as readonly TimingKind[]).includes(timing);
}

/**
 * Whether the appointment of `queued` is still what its message is about at
 * `now`: one that has not started or been cancelled; for one queued on or
 * after its attendance, one still attended, however long ago
 * (docs/domain/messages.md § When Meta limits the number); for
 * `turno_cancelado`, one the business cancelled that has not started. A
 * message timed before the appointment goes only while it is off the "to
 * reschedule" list, which would remind the patient of a time nobody works;
 * `turno_a_reprogramar` only while it is on it.
 */
function stillAbout(database: Database, queued: Queued, now: number) {
  if (queued.kind === "timed" && isAttendedTiming(queued.timing)) {
    return queued.status === "attended";
  }
  if (queued.kind === "appointmentCancelled") {
    return (
      queued.status === "cancelled" && queued.cancelledBy === "business" && queued.startsAt > now
    );
  }
  if (!upcomingStatuses.includes(queued.status) || queued.startsAt <= now) {
    return false;
  }
  if (queued.kind === "appointmentToReschedule") {
    return isToReschedule(database, queued.appointmentId);
  }
  if (queued.kind === "timed" && queued.timing === "before") {
    return !isToReschedule(database, queued.appointmentId);
  }
  return true;
}

/** Why `queued` may not go now, if anything. */
function dropReason(database: Database, queued: Queued, now: number) {
  if (!stillAbout(database, queued, now)) {
    return "appointmentChanged" as const;
  }
  if (!queued.whatsappConsent) {
    return "noConsent" as const;
  }
  return null;
}

/** Records a failed attempt: the message goes again later, or fails for good after its last. */
function recordFailure(database: Database, id: string, attempts: number, error: MetaError) {
  const next = retryAt(attempts, Date.now());
  database
    .update(outboxMessage)
    .set({
      attempts,
      errorCode: error.code,
      errorMessage: error.message,
      ...(next === null ? { state: "failed" as const } : { dueAt: next }),
    })
    .where(eq(outboxMessage.id, id))
    .run();
}

/**
 * What the queued message `id` says and to whom, read now: from its
 * appointment, or for the reopen template from its conversation
 * (`late-replies.ts`); why it is dropped instead; `null` once it is not queued.
 */
function toSend(database: Database, id: string, kind: OutboxKind) {
  if (kind === "reopenConversation") {
    const reopen = reopenToSend(database, id);
    const organizacion = organizationName(database);
    return (
      reopen &&
      (reopen.drop ? reopen : { ...reopen, values: { paciente: reopen.paciente, organizacion } })
    );
  }
  const queued = readQueued(database, id);
  if (!queued) {
    return null;
  }
  const drop = dropReason(database, queued, Date.now());
  if (drop) {
    return { drop };
  }
  const values = templateValues({
    patient: queued,
    practitionerName: queued.practitionerName,
    start: new Date(queued.startsAt),
    timeZone: queued.timeZone,
    officeName: queued.officeName,
    officeAddress: queued.officeAddress,
    organizationName: organizationName(database),
  });
  return { drop: null, to: queued.guardianPhone ?? queued.patientPhone, values };
}

/** Sends the queued message `due`, if it is still queued and may still go. */
async function sendQueued(
  database: Database,
  cloud: WhatsappCloud,
  due: { id: string; kind: OutboxKind; templateId: string; attempts: number },
) {
  const { id, kind, templateId } = due;
  const prepared = toSend(database, id, kind);
  if (!prepared) {
    return;
  }
  if (prepared.drop) {
    database
      .update(outboxMessage)
      .set({ state: "dropped", dropReason: prepared.drop })
      .where(eq(outboxMessage.id, id))
      .run();
    return;
  }
  // Read again: a template can change at Meta while an earlier send waits.
  const version = approvedVersion(database, templateId);
  if (!version) {
    return;
  }
  const filled = fillTemplate(version.body, prepared.values);
  const attempts = due.attempts + 1;
  const message: TemplateMessage = {
    to: prepared.to,
    templateName: metaTemplateName(templateId, version.version),
    languageCode: version.language,
    parameters: filled.parameters,
  };
  const sent = await whileSending(database, () => cloud.sendTemplate(message)).catch(
    (error: unknown) =>
      ({
        ok: false,
        metaError: { code: null, message: error instanceof Error ? error.message : "Send failed" },
      }) as const,
  );
  if (!sent.ok) {
    // A limit on the number holds every message, this one with no attempt spent.
    if (!holdOnRefusal(database, sent.metaError)) {
      recordFailure(database, id, attempts, sent.metaError);
    }
    return;
  }
  recordSent(database, id, attempts, { ...message, text: filled.text, sent });
}

/**
 * Stores what Meta accepted as an outgoing message, in the conversation of
 * the number Meta delivered it to, and marks the queued message sent.
 */
function recordSent(
  database: Database,
  id: string,
  attempts: number,
  message: TemplateMessage & { text: string; sent: { messageId: string; waId: string | null } },
) {
  const { sent } = message;
  database.transaction((tx) => {
    const stored = storeOutgoing(database, tx, {
      // Meta's id for the recipient is the number their replies come from.
      phone: sent.waId ? `+${sent.waId}` : message.to,
      whatsappId: sent.messageId,
      type: "template",
      text: message.text,
      payload: JSON.stringify({
        template: message.templateName,
        language: message.languageCode,
        parameters: message.parameters,
      }),
    });
    tx.update(outboxMessage)
      .set({ state: "sent", attempts, whatsappMessageId: stored.id })
      .where(eq(outboxMessage.id, id))
      .run();
  });
}

/**
 * Sends every queued message that is due, oldest due first: the object's
 * alarm. Each one is read again as it goes, so a message about an appointment
 * changed while an earlier one was sending is judged by the change.
 */
async function sendDueMessages(database: Database, cloud: WhatsappCloud) {
  const templates = sendableTemplates(database, cloud);
  if (!templates) {
    return;
  }
  const due = database
    .select({
      id: outboxMessage.id,
      kind: outboxMessage.kind,
      templateId: outboxMessage.templateId,
      attempts: outboxMessage.attempts,
    })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.templateId, templates),
        lte(outboxMessage.dueAt, Date.now()),
        notHeldByOptOut(database),
      ),
    )
    .orderBy(asc(outboxMessage.dueAt))
    .all();
  for (const one of due) {
    // Meta refusing the token, or limiting the number, mid-batch leaves the rest queued, not failed.
    if (cloud.missingSetting() || activeHold(database, Date.now())) {
      return;
    }
    await sendQueued(database, cloud, one);
  }
}

/** The outbox's queued messages, sent when due. */
export const outboxJob: Job = {
  name: "outbox",
  nextDue: (database, { whatsapp }) => nextOutboxAlarm(database, whatsapp),
  run: (database, { whatsapp }) => sendDueMessages(database, whatsapp),
};
