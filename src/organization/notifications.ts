import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Role } from "#/lib/access.ts";
import { notificationListSize, notificationReferenceSchema } from "#/lib/notifications.ts";
import type { NotificationReference } from "#/lib/notifications.ts";
import { patientName } from "#/lib/patients.ts";
import { today } from "#/lib/schedules.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import {
  appointment,
  member,
  notification,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import {
  conversationPatient,
  handoff,
  template,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";

// Notifications to staff (`src/lib/notifications.ts`): written in the
// transaction of the event they tell of, one row per recipient, each read on
// its own. A member reads only their own.

type NotificationContent = Omit<
  typeof notification.$inferInsert,
  "id" | "recipientId" | "readAt" | "createdAt" | "updatedAt"
>;

/** The active members with one of `roles`. */
function activeWith(tx: Writer, roles: readonly Role[]) {
  return tx
    .select({ userId: member.userId, roles: member.roles })
    .from(member)
    .where(eq(member.active, true))
    .all()
    .filter((row) => row.roles.some((role) => roles.includes(role)))
    .map((row) => row.userId);
}

/**
 * Notifies each of `recipientIds` of `content`, a row per insert: each row
 * binds several parameters, and the object's SQLite takes at most 100 a query.
 */
export function notify(tx: Writer, recipientIds: string[], content: NotificationContent) {
  for (const recipientId of recipientIds) {
    tx.insert(notification)
      .values({ ...content, recipientId })
      .run();
  }
}

/**
 * The patient a notification about `conversationId` stores: its number's only
 * one, by the rule the list names one by for a notification that stores none
 * (`onlyPatient`).
 */
export function notifiedPatientOf(tx: Writer, conversationId: string) {
  return onlyPatient(firstPatientOf(tx, [conversationId]).get(conversationId))?.id ?? null;
}

/** Notifies every active admin of `content`. */
export function notifyAdmins(tx: Writer, content: NotificationContent) {
  notify(tx, activeWith(tx, ["admin"]), content);
}

const optOutKinds = ["optOut", "optOutReminder"] as const;

/** `patientId`'s opt-out notifications not resolved yet, the reminders' included. */
function unresolvedOptOut(patientId: string) {
  return and(
    inArray(notification.kind, optOutKinds),
    eq(notification.patientId, patientId),
    isNull(notification.resolvedAt),
  );
}

/**
 * Notifies reception and the admins that `patientId`'s number asked to stop
 * getting messages in `messageId`, so a person turns their WhatsApp consent
 * off or keeps it there: one notification each per pending decision.
 */
export function notifyOptOut(tx: Writer, patientId: string, messageId: string) {
  notify(tx, activeWith(tx, ["admin", "receptionist"]), { kind: "optOut", patientId, messageId });
}

/**
 * Reminds reception and the admins that nobody decided on `patientId` yet:
 * each one's notification of them is unread again and new, and one who has
 * none, such as a member who joined since, gets one. A member who is no longer
 * either keeps theirs as it is.
 */
export function remindOptOut(tx: Writer, patientId: string, messageId: string | null) {
  const now = Date.now();
  const active = activeWith(tx, ["admin", "receptionist"]);
  const theirs = tx
    .select({ id: notification.id, recipientId: notification.recipientId })
    .from(notification)
    .where(unresolvedOptOut(patientId))
    .all()
    .filter((row) => active.includes(row.recipientId));
  // A row per update, as `notify` inserts: the object's SQLite binds at most 100 parameters a query.
  for (const { id } of theirs) {
    tx.update(notification)
      .set({ kind: "optOutReminder", readAt: null, createdAt: now })
      .where(eq(notification.id, id))
      .run();
  }
  const reminded = new Set(theirs.map((row) => row.recipientId));
  notify(
    tx,
    active.filter((id) => !reminded.has(id)),
    { kind: "optOutReminder", patientId, messageId },
  );
}

/** Resolves everyone's notification of `patientId`'s opt-out, once a person decided on them. */
export function resolveOptOut(tx: Writer, patientId: string) {
  const now = Date.now();
  tx.update(notification)
    .set({ resolvedAt: now, readAt: sql`coalesce(${notification.readAt}, ${now})` })
    .where(unresolvedOptOut(patientId))
    .run();
}

/** Notifies reception and the admins that a patient cancelled `appointmentId` through the assistant. */
export function notifyCancellation(tx: Writer, appointmentId: string) {
  notify(tx, activeWith(tx, ["admin", "receptionist"]), {
    kind: "appointmentCancelled",
    appointmentId,
  });
}

/** Deletes the notifications of `appointmentId`'s cancellation, once it is undone and they no longer hold. */
export function withdrawCancellation(tx: Writer, appointmentId: string) {
  tx.delete(notification)
    .where(
      and(
        eq(notification.kind, "appointmentCancelled"),
        eq(notification.appointmentId, appointmentId),
      ),
    )
    .run();
}

const handedOffAppointment = alias(appointment, "handed_off_appointment");
const handedOffPatient = alias(patient, "handed_off_patient");
const cancelledPatient = alias(patient, "cancelled_patient");

/**
 * The first patient, by name, each of `conversationIds`' number stands for,
 * and whether they are its only one.
 */
function firstPatientOf(database: Writer, conversationIds: string[]) {
  const rows =
    conversationIds.length === 0
      ? []
      : database
          .select({
            conversationId: conversationPatient.conversationId,
            id: patient.id,
            phone: patient.phone,
            firstName: patient.firstName,
            lastName: patient.lastName,
            chosenName: patient.chosenName,
          })
          .from(conversationPatient)
          .innerJoin(patient, eq(patient.id, conversationPatient.patientId))
          .where(inArray(conversationPatient.conversationId, conversationIds))
          .orderBy(asc(patient.lastName), asc(patient.firstName))
          .all();
  const first = new Map<string, { id: string; name: string; phone: string; only: boolean }>();
  for (const row of rows) {
    const found = first.get(row.conversationId);
    if (found) {
      found.only = false;
    } else {
      const patient = { id: row.id, name: patientName(row), phone: row.phone, only: true };
      first.set(row.conversationId, patient);
    }
  }
  return first;
}

/** The number's patient, for a notification about its conversation: only when it has one, since with several it cannot tell whose. */
function onlyPatient(
  first: { id: string; name: string; phone: string; only: boolean } | undefined,
) {
  return first?.only ? { id: first.id, name: first.name, phone: first.phone } : null;
}

/** Whether `acting` is a practitioner who keeps clinical records. */
function keepsRecords(database: Database, acting: Acting) {
  const own = acting.roles.includes("practitioner")
    ? database
        .select({ keeps: practitioner.keepsClinicalRecords })
        .from(practitioner)
        .where(eq(practitioner.memberId, acting.userId))
        .get()
    : undefined;
  return own?.keeps === true;
}

/**
 * A cancellation's notification as it reads: who cancelled, with whom and
 * when, and where its time is on the agenda; `null` for another kind.
 */
function cancelledAppointment(row: {
  cancelledId: string | null;
  cancelledStartsAt: number | null;
  cancelledRoomId: string | null;
  cancelledTimeZone: string | null;
  cancelledPractitioner: string | null;
  cancelledFirstName: string | null;
  cancelledLastName: string | null;
  cancelledChosenName: string | null;
}) {
  if (
    row.cancelledId === null ||
    row.cancelledStartsAt === null ||
    row.cancelledTimeZone === null
  ) {
    return null;
  }
  return {
    id: row.cancelledId,
    patient: patientName({
      firstName: row.cancelledFirstName!,
      lastName: row.cancelledLastName!,
      chosenName: row.cancelledChosenName,
    }),
    practitioner: row.cancelledPractitioner!,
    startsAt: row.cancelledStartsAt,
    timeZone: row.cancelledTimeZone,
    roomId: row.cancelledRoomId!,
    date: today(row.cancelledTimeZone, new Date(row.cancelledStartsAt)),
  };
}

/**
 * `acting`'s notifications, unread first, each part newest first: an unread
 * one stays in the list however many came after it.
 */
export function listNotifications(database: Database, acting: Acting) {
  // A handoff to the practitioner reaches someone who keeps no clinical
  // records only when nobody active does (`handoffs.ts`).
  const noPractitioner = !keepsRecords(database, acting);
  const rows = database
    .select({
      id: notification.id,
      kind: notification.kind,
      templateId: notification.templateId,
      templateName: template.name,
      templateVersion: notification.templateVersion,
      detail: notification.detail,
      until: notification.until,
      waiting: notification.waiting,
      notDeliveredIn: notification.conversationId,
      messageId: notification.messageId,
      optOutIn: whatsappMessage.conversationId,
      readAt: notification.readAt,
      resolvedAt: notification.resolvedAt,
      createdAt: notification.createdAt,
      conversationId: handoff.conversationId,
      handoffReason: handoff.reason,
      handoffForPractitioner: handoff.forPractitioner,
      handoffDetail: handoff.detail,
      handedOffFirstName: handedOffPatient.firstName,
      handedOffLastName: handedOffPatient.lastName,
      handedOffChosenName: handedOffPatient.chosenName,
      patientId: patient.id,
      firstName: patient.firstName,
      chosenName: patient.chosenName,
      lastName: patient.lastName,
      phone: patient.phone,
      cancelledId: appointment.id,
      cancelledStartsAt: appointment.startsAt,
      cancelledRoomId: appointment.roomId,
      cancelledTimeZone: office.timeZone,
      cancelledPractitioner: practitioner.displayName,
      cancelledFirstName: cancelledPatient.firstName,
      cancelledLastName: cancelledPatient.lastName,
      cancelledChosenName: cancelledPatient.chosenName,
    })
    .from(notification)
    .leftJoin(handoff, eq(handoff.id, notification.handoffId))
    .leftJoin(handedOffAppointment, eq(handedOffAppointment.id, handoff.appointmentId))
    .leftJoin(handedOffPatient, eq(handedOffPatient.id, handedOffAppointment.patientId))
    .leftJoin(template, eq(template.id, notification.templateId))
    .leftJoin(whatsappMessage, eq(whatsappMessage.id, notification.messageId))
    .leftJoin(patient, eq(patient.id, notification.patientId))
    .leftJoin(appointment, eq(appointment.id, notification.appointmentId))
    .leftJoin(cancelledPatient, eq(cancelledPatient.id, appointment.patientId))
    .leftJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .leftJoin(room, eq(room.id, appointment.roomId))
    .leftJoin(office, eq(office.id, room.officeId))
    .where(eq(notification.recipientId, acting.userId))
    .orderBy(sql`${notification.readAt} is not null`, desc(notification.createdAt))
    .limit(notificationListSize)
    .all();
  // A handoff about no appointment names the first patient its number stands
  // for; a notification of a conversation that stores none, its only one.
  const firstPatients = firstPatientOf(database, [
    ...new Set(
      rows.flatMap((row) => [row.conversationId, row.notDeliveredIn].filter((id) => id !== null)),
    ),
  ]);
  return {
    ok: true,
    notifications: rows.map(
      ({
        readAt,
        resolvedAt,
        notDeliveredIn,
        optOutIn,
        conversationId,
        handoffReason,
        handoffForPractitioner,
        handoffDetail,
        handedOffFirstName,
        handedOffLastName,
        handedOffChosenName,
        patientId,
        firstName,
        chosenName,
        lastName,
        phone,
        cancelledId,
        cancelledStartsAt,
        cancelledRoomId,
        cancelledTimeZone,
        cancelledPractitioner,
        cancelledFirstName,
        cancelledLastName,
        cancelledChosenName,
        ...row
      }) => ({
        ...row,
        read: readAt !== null,
        resolved: resolvedAt !== null,
        // The conversation of a handoff, of a reply that was not delivered, or of an opt-out's message.
        conversationId: notDeliveredIn ?? conversationId ?? optOutIn,
        // A handoff's notification says what it was about and where, never the patient's words.
        handoff:
          conversationId !== null && handoffReason !== null
            ? {
                conversationId,
                reason: handoffReason,
                forPractitioner: handoffForPractitioner === true,
                noPractitioner: handoffForPractitioner === true && noPractitioner,
                patient:
                  handedOffFirstName !== null && handedOffLastName !== null
                    ? patientName({
                        firstName: handedOffFirstName,
                        lastName: handedOffLastName,
                        chosenName: handedOffChosenName,
                      })
                    : (firstPatients.get(conversationId)?.name ?? null),
                detail: handoffDetail,
              }
            : null,
        // An opt-out's names the patient whose consent to turn off, never the patient's words.
        patient:
          patientId !== null && firstName !== null && lastName !== null && phone !== null
            ? { id: patientId, name: patientName({ firstName, lastName, chosenName }), phone }
            : onlyPatient(firstPatients.get(notDeliveredIn ?? "")),
        appointment: cancelledAppointment({
          cancelledId,
          cancelledStartsAt,
          cancelledRoomId,
          cancelledTimeZone,
          cancelledPractitioner,
          cancelledFirstName,
          cancelledLastName,
          cancelledChosenName,
        }),
      }),
    ),
  } as const;
}

/** How many of `acting`'s notifications are unread, for the menu. */
export function countUnreadNotifications(database: Database, acting: Acting) {
  const counted = database
    .select({ count: count() })
    .from(notification)
    .where(and(eq(notification.recipientId, acting.userId), isNull(notification.readAt)))
    .get();
  return { ok: true, count: counted?.count ?? 0 } as const;
}

/** Marks one of `acting`'s notifications read; another member's is not found. */
export function markNotificationRead(
  database: Database,
  acting: Acting,
  input: NotificationReference,
) {
  const parsed = notificationReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const marked = database
    .update(notification)
    .set({ readAt: Date.now() })
    .where(
      and(
        eq(notification.id, parsed.data.notificationId),
        eq(notification.recipientId, acting.userId),
      ),
    )
    .returning({ id: notification.id })
    .get();
  return marked ? ({ ok: true } as const) : ({ ok: false, reason: "notFound" } as const);
}
