import { and, asc, desc, eq, inArray, lte, min } from "drizzle-orm";

import { outboxTemplates, retryAt } from "#/lib/outbox.ts";
import type { OutboxKind } from "#/lib/outbox.ts";
import { fillTemplate } from "#/lib/template-filling.ts";
import { metaTemplateName } from "#/lib/whatsapp-templates.ts";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError, TemplateMessage, WhatsappCloud } from "#/organization/graph-api.ts";
import {
  appointment,
  guardian,
  medicalService,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import { outboxMessage, whatsappTemplate } from "#/organization/whatsapp-schema.ts";
import { storeOutgoing, whileSending } from "#/organization/whatsapp-messages.ts";

// The outbox (`src/lib/outbox.ts`): messages to patients, queued in the
// transaction that changes their appointment and sent by the object's alarm
// once due. A queued message is read again when it goes: what it says comes
// from the appointment as it is then, and one no longer true or no longer
// allowed is dropped. Nothing here logs a patient's data or Meta's token.

/** Statuses an appointment can still be told it was booked in: it has not started or been cancelled. */
const confirmableStatuses = ["booked", "confirmed"] as const;

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

/** The latest approved version of template `name`, the one that goes; `null` while none is approved. */
export function approvedVersion(database: Database, name: TemplateName) {
  return (
    database
      .select({
        version: whatsappTemplate.version,
        language: whatsappTemplate.language,
        body: whatsappTemplate.body,
      })
      .from(whatsappTemplate)
      .where(and(eq(whatsappTemplate.name, name), eq(whatsappTemplate.status, "approved")))
      .orderBy(desc(whatsappTemplate.version))
      .get() ?? null
  );
}

/** The kinds that can go now: Meta's settings are complete and their template has an approved version. */
function sendableKinds(database: Database, cloud: WhatsappCloud): OutboxKind[] {
  if (cloud.missingSetting()) {
    return [];
  }
  return (Object.keys(outboxTemplates) as OutboxKind[]).filter((kind) =>
    approvedVersion(database, outboxTemplates[kind]),
  );
}

/**
 * When the object's alarm should next fire: at the earliest queued message
 * that can go, or `null` when none can. A message waiting for its template's
 * approval or for Meta's settings is left out, so the alarm does not spin.
 */
export function nextOutboxAlarm(database: Database, cloud: WhatsappCloud): number | null {
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
      kind: outboxMessage.kind,
      attempts: outboxMessage.attempts,
      status: appointment.status,
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

/** Why `queued` may not go now, if anything. */
function dropReason(queued: Queued, now: number) {
  if (
    !(confirmableStatuses as readonly string[]).includes(queued.status) ||
    queued.startsAt <= now
  ) {
    return "appointmentChanged" as const;
  }
  return queued.whatsappConsent ? null : ("noConsent" as const);
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

/** Sends the queued message `id`, if it is still queued and may still go. */
async function sendQueued(database: Database, cloud: WhatsappCloud, id: string) {
  const queued = readQueued(database, id);
  if (!queued) {
    return;
  }
  const dropped = dropReason(queued, Date.now());
  if (dropped) {
    database
      .update(outboxMessage)
      .set({ state: "dropped", dropReason: dropped })
      .where(eq(outboxMessage.id, id))
      .run();
    return;
  }
  const templateName = outboxTemplates[queued.kind];
  const template = approvedVersion(database, templateName);
  if (!template) {
    return;
  }
  const filled = fillTemplate(template.body, {
    patient: queued,
    practitionerName: queued.practitionerName,
    start: new Date(queued.startsAt),
    timeZone: queued.timeZone,
    officeName: queued.officeName,
    officeAddress: queued.officeAddress,
    careInstructions: null,
  });
  const to = queued.guardianPhone ?? queued.patientPhone;
  const attempts = queued.attempts + 1;
  const message: TemplateMessage = {
    to,
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
    recordFailure(database, id, attempts, sent.metaError);
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
export async function sendDueMessages(database: Database, cloud: WhatsappCloud) {
  const kinds = sendableKinds(database, cloud);
  if (kinds.length === 0) {
    return;
  }
  const due = database
    .select({ id: outboxMessage.id })
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
  for (const { id } of due) {
    // Meta refusing the token mid-batch leaves the rest queued, not failed.
    if (cloud.missingSetting()) {
      return;
    }
    await sendQueued(database, cloud, id);
  }
}
