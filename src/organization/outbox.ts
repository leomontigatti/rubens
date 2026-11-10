import { and, asc, eq, gt, inArray, lt, lte, min } from "drizzle-orm";

import {
  aftercareKinds,
  followUpDueAt,
  outboxTemplates,
  reminderDueAt,
  reminderKinds,
  retryAt,
} from "#/lib/outbox.ts";
import type { OutboxKind } from "#/lib/outbox.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { fillTemplate, flattenCareInstructions, templateValues } from "#/lib/template-filling.ts";
import { metaTemplateName } from "#/lib/whatsapp-templates.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError, TemplateMessage, WhatsappCloud } from "#/organization/graph-api.ts";
import {
  appointment,
  guardian,
  medicalService,
  medicalServiceReminder,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";
import { reopenToSend } from "#/organization/late-replies.ts";
import { isToReschedule } from "#/organization/to-reschedule.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import { storeOutgoing, whileSending } from "#/organization/whatsapp-messages.ts";
import { approvedVersion } from "#/organization/whatsapp-templates.ts";

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
 * Statuses an appointment is still told about, its booking and its
 * reminders: it has not started or been cancelled.
 */
export const upcomingStatuses: readonly AppointmentStatus[] = ["booked", "confirmed"];

/**
 * Queues the booking confirmation of the appointment `appointmentId`, in the
 * booking's transaction, when its medical service sends it and its patient
 * accepts WhatsApp.
 */
export function queueBookingConfirmation(tx: Writer, appointmentId: string) {
  const booked = tx
    .select({
      bookingConfirmation: medicalService.bookingConfirmation,
      whatsappConsent: patient.whatsappConsent,
    })
    .from(appointment)
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!booked?.bookingConfirmation || !booked.whatsappConsent) {
    return;
  }
  tx.insert(outboxMessage)
    .values({ kind: "bookingConfirmation", appointmentId, dueAt: Date.now() })
    .run();
}

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
 * Queues again the reminders of `patientId`'s upcoming appointments: in the
 * transaction that turns their WhatsApp consent back on, since turning it
 * off dropped them (`dropQueuedForPatient`).
 */
export function requeueRemindersForPatient(tx: Writer, patientId: string) {
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
    queueReminders(tx, id);
  }
}

/**
 * Drops the queued reminders of the appointment `appointmentId` and, while it
 * is booked or confirmed and its patient accepts WhatsApp, queues its medical
 * service's reminders for its time now: in the transaction that booked, moved
 * or reinstated it. A reminder whose time has already passed is skipped, not
 * sent late.
 */
export function queueReminders(tx: Writer, appointmentId: string) {
  tx.update(outboxMessage)
    .set({ state: "dropped", dropReason: "appointmentChanged" })
    .where(
      and(
        eq(outboxMessage.appointmentId, appointmentId),
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, reminderKinds),
      ),
    )
    .run();
  const booked = tx
    .select({
      status: appointment.status,
      startsAt: appointment.startsAt,
      medicalServiceId: appointment.medicalServiceId,
      whatsappConsent: patient.whatsappConsent,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!booked || !upcomingStatuses.includes(booked.status) || !booked.whatsappConsent) {
    return;
  }
  const now = Date.now();
  const rows = tx
    .select({
      hoursBefore: medicalServiceReminder.hoursBefore,
      asksToConfirm: medicalServiceReminder.asksToConfirm,
    })
    .from(medicalServiceReminder)
    .where(eq(medicalServiceReminder.medicalServiceId, booked.medicalServiceId))
    .all()
    .map(({ hoursBefore, asksToConfirm }) => ({
      kind: asksToConfirm ? ("reminder" as const) : ("reminderWithoutConfirmation" as const),
      appointmentId,
      hoursBefore,
      dueAt: reminderDueAt(booked.startsAt, hoursBefore),
    }))
    .filter((row) => row.dueAt >= now);
  if (rows.length > 0) {
    tx.insert(outboxMessage).values(rows).run();
  }
}

/**
 * Queues the care instructions and the follow-up of the appointment
 * `appointmentId`, in the transaction that marked it attended, each when its
 * medical service has it and its patient accepts WhatsApp: the care
 * instructions at once, the follow-up its hours after the appointment ends.
 */
function queueAftercare(tx: Writer, appointmentId: string) {
  const attended = tx
    .select({
      endsAt: appointment.endsAt,
      careInstructions: medicalService.careInstructions,
      followUpHours: medicalService.followUpHours,
      whatsappConsent: patient.whatsappConsent,
    })
    .from(appointment)
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!attended?.whatsappConsent) {
    return;
  }
  const rows: (typeof outboxMessage.$inferInsert)[] = [];
  if (attended.careInstructions) {
    rows.push({ kind: "careInstructions", appointmentId, dueAt: Date.now() });
  }
  if (attended.followUpHours !== null) {
    const dueAt = followUpDueAt(attended.endsAt, attended.followUpHours);
    rows.push({ kind: "followUp", appointmentId, dueAt });
  }
  if (rows.length > 0) {
    tx.insert(outboxMessage).values(rows).run();
  }
}

/**
 * Requeues the messages of the appointment `placed` that a status change
 * affects: its reminders when the change takes it out of the statuses that
 * get them, or back into them; its care instructions and follow-up when it
 * marks it attended, or undoes that.
 */
export function requeueOnStatus(
  tx: Writer,
  placed: { id: string; status: AppointmentStatus },
  nextStatus: AppointmentStatus,
) {
  if (upcomingStatuses.includes(placed.status) !== upcomingStatuses.includes(nextStatus)) {
    queueReminders(tx, placed.id);
  }
  if (nextStatus === "attended" && placed.status !== "attended") {
    queueAftercare(tx, placed.id);
  }
  if (placed.status === "attended" && nextStatus !== "attended") {
    tx.update(outboxMessage)
      .set({ state: "dropped", dropReason: "appointmentChanged" })
      .where(
        and(
          eq(outboxMessage.appointmentId, placed.id),
          eq(outboxMessage.state, "queued"),
          inArray(outboxMessage.kind, aftercareKinds),
        ),
      )
      .run();
  }
}

/**
 * The kinds that can go now: Meta's settings are complete, the number is not
 * held (`whatsapp-limits.ts`), and their template has an approved version.
 */
function sendableKinds(database: Database, cloud: WhatsappCloud): OutboxKind[] {
  if (cloud.missingSetting() || activeHold(database, Date.now())) {
    return [];
  }
  return (Object.keys(outboxTemplates) as OutboxKind[]).filter((kind) =>
    approvedVersion(database, outboxTemplates[kind]),
  );
}

/**
 * When the object's alarm should next fire: at the earliest queued message
 * that can go, or `null` when none can. A message waiting for its template's
 * approval or for Meta's settings is left out, so the alarm does not spin;
 * one waiting on a hold of the number, until the hold ends, if it ends by time.
 */
export function nextOutboxAlarm(database: Database, cloud: WhatsappCloud): number | null {
  const hold = activeHold(database, Date.now());
  if (hold) {
    const anyQueued = database
      .select({ id: outboxMessage.id })
      .from(outboxMessage)
      .where(eq(outboxMessage.state, "queued"))
      .get();
    return anyQueued ? hold.until : null;
  }
  const kinds = sendableKinds(database, cloud);
  if (kinds.length === 0) {
    return null;
  }
  const next = database
    .select({ dueAt: min(outboxMessage.dueAt) })
    .from(outboxMessage)
    .where(and(eq(outboxMessage.state, "queued"), inArray(outboxMessage.kind, kinds)))
    .get();
  return next?.dueAt ?? null;
}

/** A queued message, with its appointment as it is now and the number messages to its patient go to. */
function readQueued(database: Database, id: string) {
  return database
    .select({
      id: outboxMessage.id,
      kind: outboxMessage.kind,
      appointmentId: appointment.id,
      hoursBefore: outboxMessage.hoursBefore,
      status: appointment.status,
      cancelledBy: appointment.cancelledBy,
      startsAt: appointment.startsAt,
      careInstructions: medicalService.careInstructions,
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
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .leftJoin(guardian, and(eq(guardian.patientId, patient.id), eq(guardian.messageContact, true)))
    .where(and(eq(outboxMessage.id, id), eq(outboxMessage.state, "queued")))
    .get();
}

type Queued = NonNullable<ReturnType<typeof readQueued>>;

/**
 * Whether a later reminder for the appointment of `queued`, one set fewer
 * hours before it, is due too and goes instead: only while its kind can go
 * (`sendable`), or neither would. One that already went dropped the earlier
 * ones when it was sent (`dropEarlierReminders`).
 */
function overtaken(database: Database, queued: Queued, now: number, sendable: OutboxKind[]) {
  if (queued.hoursBefore === null) {
    return false;
  }
  const later = database
    .select({ hoursBefore: outboxMessage.hoursBefore })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.appointmentId, queued.appointmentId),
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, sendable),
        lt(outboxMessage.hoursBefore, queued.hoursBefore),
      ),
    )
    .all();
  return later.some((one) => reminderDueAt(queued.startsAt, one.hoursBefore!) <= now);
}

/**
 * Whether the appointment of `queued` is still what its message is about at
 * `now`: one that has not started or been cancelled; for the care
 * instructions and the follow-up, one still attended, however long ago
 * (docs/domain/messages.md § When Meta limits the number); for
 * `turno_cancelado`, one the business cancelled that has not started. A
 * reminder goes only while the appointment is off the "to reschedule" list,
 * which would remind the patient of a time nobody works; `turno_a_reprogramar`
 * only while it is on it.
 */
function stillAbout(database: Database, queued: Queued, now: number) {
  if ((aftercareKinds as readonly OutboxKind[]).includes(queued.kind)) {
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
  if ((reminderKinds as readonly OutboxKind[]).includes(queued.kind)) {
    return !isToReschedule(database, queued.appointmentId);
  }
  return true;
}

/** Why `queued` may not go now, if anything. */
function dropReason(database: Database, queued: Queued, now: number, sendable: OutboxKind[]) {
  if (!stillAbout(database, queued, now)) {
    return "appointmentChanged" as const;
  }
  if (!queued.whatsappConsent) {
    return "noConsent" as const;
  }
  if (
    queued.kind === "careInstructions" &&
    !flattenCareInstructions(queued.careInstructions ?? "")
  ) {
    return "noCareInstructions" as const;
  }
  return overtaken(database, queued, now, sendable) ? ("overtaken" as const) : null;
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
function toSend(database: Database, cloud: WhatsappCloud, id: string, kind: OutboxKind) {
  if (kind === "reopenConversation") {
    const reopen = reopenToSend(database, id);
    return reopen && (reopen.drop ? reopen : { ...reopen, values: { paciente: reopen.paciente } });
  }
  const queued = readQueued(database, id);
  if (!queued) {
    return null;
  }
  // Read again: a template can change at Meta while an earlier send waits.
  const drop = dropReason(database, queued, Date.now(), sendableKinds(database, cloud));
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
    careInstructions: flattenCareInstructions(queued.careInstructions ?? ""),
  });
  return { drop: null, to: queued.guardianPhone ?? queued.patientPhone, values, queued };
}

/** Sends the queued message `id`, if it is still queued and may still go. */
async function sendQueued(
  database: Database,
  cloud: WhatsappCloud,
  due: { id: string; kind: OutboxKind; attempts: number },
) {
  const { id, kind } = due;
  const prepared = toSend(database, cloud, id, kind);
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
  const templateName = outboxTemplates[kind];
  const template = approvedVersion(database, templateName);
  if (!template) {
    return;
  }
  const filled = fillTemplate(template.body, prepared.values);
  const attempts = due.attempts + 1;
  const message: TemplateMessage = {
    to: prepared.to,
    templateName: metaTemplateName(templateName, template.version),
    languageCode: template.language,
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
  const overtakes = "queued" in prepared ? (prepared.queued ?? null) : null;
  recordSent(database, { id, overtakes }, attempts, { ...message, text: filled.text, sent });
}

/**
 * Drops the queued reminders `sent` overtook: those of its appointment set
 * more hours before it, still waiting for a retry or their template.
 */
function dropEarlierReminders(tx: Writer, sent: Queued) {
  if (sent.hoursBefore === null) {
    return;
  }
  tx.update(outboxMessage)
    .set({ state: "dropped", dropReason: "overtaken" })
    .where(
      and(
        eq(outboxMessage.appointmentId, sent.appointmentId),
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, reminderKinds),
        gt(outboxMessage.hoursBefore, sent.hoursBefore),
      ),
    )
    .run();
}

/**
 * Stores what Meta accepted as an outgoing message, in the conversation of
 * the number Meta delivered it to, and marks the queued message sent, with
 * the reminders it overtook dropped.
 */
function recordSent(
  database: Database,
  queued: { id: string; overtakes: Queued | null },
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
    // A change to the appointment while Meta answered dropped it and queued
    // its reminders afresh: it went all the same, and overtook none of those.
    const stillQueued =
      tx
        .select({ state: outboxMessage.state })
        .from(outboxMessage)
        .where(eq(outboxMessage.id, queued.id))
        .get()?.state === "queued";
    tx.update(outboxMessage)
      .set({ state: "sent", attempts, whatsappMessageId: stored.id })
      .where(eq(outboxMessage.id, queued.id))
      .run();
    if (stillQueued && queued.overtakes) {
      dropEarlierReminders(tx, queued.overtakes);
    }
  });
}

/**
 * Sends every queued message that is due, oldest due first: the object's
 * alarm. Each one is read again as it goes, so a message about an appointment
 * changed while an earlier one was sending is judged by the change.
 */
export async function sendDueMessages(database: Database, cloud: WhatsappCloud) {
  const kinds = sendableKinds(database, cloud);
  if (kinds.length === 0) {
    return;
  }
  const due = database
    .select({ id: outboxMessage.id, kind: outboxMessage.kind, attempts: outboxMessage.attempts })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, kinds),
        lte(outboxMessage.dueAt, Date.now()),
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
