import { and, eq, gt, inArray } from "drizzle-orm";

import type { AppointmentStatus } from "#/lib/appointments.ts";
import { attendedTimings, bookingTimings, timingDueAt, timingOf } from "#/lib/template-timing.ts";
import type { TimingKind } from "#/lib/template-timing.ts";

import type { Writer } from "#/organization/database.ts";
import { appointment, patient } from "#/organization/schema.ts";
import {
  medicalServiceTemplate,
  outboxMessage,
  template,
  whatsappTemplate,
} from "#/organization/whatsapp-schema.ts";

// The messages of the organization's own templates (docs/domain/messages.md
// § The organization's templates): queued in the transaction that books,
// moves, attends or changes an appointment, each for its template's timing,
// and rebuilt when a template's timing or approval, or a medical service's
// picks, change. A template sends nothing until Meta has approved one of its
// versions; one paused or moved to marketing since still queues, and its
// messages wait (§ When Meta limits the number).

/** Statuses an appointment is still told about before it: it has not started or been cancelled. */
export const upcomingStatuses: readonly AppointmentStatus[] = ["booked", "confirmed"];

/** Templates Meta approved a version of at least once: a paused or disabled version was approved first. */
function liveTemplateIds(tx: Writer) {
  return tx
    .select({ id: whatsappTemplate.templateId })
    .from(whatsappTemplate)
    .where(inArray(whatsappTemplate.status, ["approved", "paused", "disabled"]));
}

/** The templates of `kinds` the medical service `medicalServiceId` picks that queue now. */
function pickedTemplates(
  tx: Writer,
  medicalServiceId: string,
  kinds: readonly TimingKind[],
  only?: string[],
) {
  return tx
    .select({ id: template.id, timing: template.timing, timingHours: template.timingHours })
    .from(medicalServiceTemplate)
    .innerJoin(template, eq(template.id, medicalServiceTemplate.templateId))
    .where(
      and(
        eq(medicalServiceTemplate.medicalServiceId, medicalServiceId),
        inArray(template.timing, [...kinds]),
        inArray(template.id, liveTemplateIds(tx)),
        only ? inArray(template.id, only) : undefined,
      ),
    )
    .all();
}

/** The appointment `appointmentId` with what queueing reads: its times, status, service and consent. */
function readAppointment(tx: Writer, appointmentId: string) {
  return tx
    .select({
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      medicalServiceId: appointment.medicalServiceId,
      whatsappConsent: patient.whatsappConsent,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(appointment.id, appointmentId))
    .get();
}

type Appointment = NonNullable<ReturnType<typeof readAppointment>>;

/**
 * Queues the messages of `kinds` the appointment's medical service picks,
 * each for its time: one already past is skipped, not sent late. With
 * `only`, only those templates.
 */
function queueTimed(
  tx: Writer,
  booked: Appointment,
  kinds: readonly TimingKind[],
  only?: string[],
) {
  if (!booked.whatsappConsent) {
    return;
  }
  const now = Date.now();
  const rows = pickedTemplates(tx, booked.medicalServiceId, kinds, only).flatMap((picked) => {
    const timing = timingOf(picked);
    const dueAt = timing && timingDueAt(timing, booked, now);
    return dueAt !== null && dueAt >= now
      ? [{ kind: "timed" as const, appointmentId: booked.id, templateId: picked.id, dueAt }]
      : [];
  });
  if (rows.length > 0) {
    tx.insert(outboxMessage).values(rows).run();
  }
}

/** The templates of the timings `kinds`. */
function templatesTimed(tx: Writer, kinds: readonly TimingKind[]) {
  return tx
    .select({ id: template.id })
    .from(template)
    .where(inArray(template.timing, [...kinds]));
}

/** Drops the queued messages of `appointmentId` whose templates are timed `kinds`. */
function dropQueued(tx: Writer, appointmentId: string, kinds: readonly TimingKind[]) {
  tx.update(outboxMessage)
    .set({ state: "dropped", dropReason: "appointmentChanged" })
    .where(
      and(
        eq(outboxMessage.appointmentId, appointmentId),
        eq(outboxMessage.state, "queued"),
        eq(outboxMessage.kind, "timed"),
        inArray(outboxMessage.templateId, templatesTimed(tx, kinds)),
      ),
    )
    .run();
}

/** Queues what the booking of `appointmentId` sends: at once, and before the appointment. */
export function queueOnBooking(tx: Writer, appointmentId: string) {
  const booked = readAppointment(tx, appointmentId);
  if (booked && upcomingStatuses.includes(booked.status)) {
    queueTimed(tx, booked, bookingTimings);
  }
}

/**
 * Drops the queued messages timed before the appointment `appointmentId` and,
 * while it is booked or confirmed, queues them for its time now: in the
 * transaction that moved or reinstated it, or turned its patient's consent
 * back on.
 */
export function requeueBefore(tx: Writer, appointmentId: string) {
  dropQueued(tx, appointmentId, ["before"]);
  const booked = readAppointment(tx, appointmentId);
  if (booked && upcomingStatuses.includes(booked.status)) {
    queueTimed(tx, booked, ["before"]);
  }
}

/**
 * Requeues the messages of the appointment `placed` that a status change
 * affects: those before it when the change takes it out of the statuses that
 * get them, or back into them; those on and after its attendance when it
 * marks it attended, or undoes that.
 */
export function requeueOnStatus(
  tx: Writer,
  placed: { id: string; status: AppointmentStatus },
  nextStatus: AppointmentStatus,
) {
  if (upcomingStatuses.includes(placed.status) !== upcomingStatuses.includes(nextStatus)) {
    requeueBefore(tx, placed.id);
  }
  if (nextStatus === "attended" && placed.status !== "attended") {
    const attended = readAppointment(tx, placed.id);
    if (attended) {
      queueTimed(tx, attended, attendedTimings);
    }
  }
  if (placed.status === "attended" && nextStatus !== "attended") {
    dropQueued(tx, placed.id, attendedTimings);
  }
}

/** The booked and confirmed appointments still ahead, of `medicalServiceIds`. */
function upcomingOf(tx: Writer, medicalServiceIds: string[]) {
  return tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        inArray(appointment.medicalServiceId, medicalServiceIds),
        inArray(appointment.status, upcomingStatuses),
        gt(appointment.startsAt, Date.now()),
      ),
    )
    .all()
    .map((row) => readAppointment(tx, row.id)!);
}

/**
 * Rebuilds the messages of template `templateId` still ahead for the booked
 * and confirmed appointments of every medical service that picks it: in the
 * transaction that changed its timing, or stored Meta's approval of it. A
 * message already due and waiting stays as it is, and its appointment gets
 * no second one.
 */
export function rebuildTemplate(tx: Writer, templateId: string) {
  const now = Date.now();
  const services = tx
    .select({ id: medicalServiceTemplate.medicalServiceId })
    .from(medicalServiceTemplate)
    .where(eq(medicalServiceTemplate.templateId, templateId))
    .all()
    .map((row) => row.id);
  for (const booked of upcomingOf(tx, services)) {
    tx.update(outboxMessage)
      .set({ state: "dropped", dropReason: "appointmentChanged" })
      .where(
        and(
          eq(outboxMessage.appointmentId, booked.id),
          eq(outboxMessage.templateId, templateId),
          eq(outboxMessage.state, "queued"),
          gt(outboxMessage.dueAt, now),
        ),
      )
      .run();
    const waiting = tx
      .select({ id: outboxMessage.id })
      .from(outboxMessage)
      .where(
        and(
          eq(outboxMessage.appointmentId, booked.id),
          eq(outboxMessage.templateId, templateId),
          eq(outboxMessage.state, "queued"),
        ),
      )
      .get();
    if (!waiting) {
      queueTimed(tx, booked, ["before"], [templateId]);
    }
  }
}

/**
 * Applies a change to the templates the medical service `medicalServiceId`
 * picks: the messages of one it no longer picks drop, due ones included, for
 * every one of its appointments; one it now picks queues what is still ahead
 * of its booked and confirmed appointments.
 */
export function rebuildPicks(
  tx: Writer,
  medicalServiceId: string,
  change: { removed: string[]; added: string[] },
) {
  if (change.removed.length > 0) {
    const theirs = tx
      .select({ id: appointment.id })
      .from(appointment)
      .where(eq(appointment.medicalServiceId, medicalServiceId));
    tx.update(outboxMessage)
      .set({ state: "dropped", dropReason: "templateUnpicked" })
      .where(
        and(
          eq(outboxMessage.state, "queued"),
          inArray(outboxMessage.appointmentId, theirs),
          inArray(outboxMessage.templateId, change.removed),
        ),
      )
      .run();
  }
  if (change.added.length > 0) {
    for (const booked of upcomingOf(tx, [medicalServiceId])) {
      queueTimed(tx, booked, ["before"], change.added);
    }
  }
}
