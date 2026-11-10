import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import type { Role } from "#/lib/access.ts";
import { notificationListSize, notificationReferenceSchema } from "#/lib/notifications.ts";
import type { NotificationReference } from "#/lib/notifications.ts";
import { patientName } from "#/lib/patients.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { member, notification, patient } from "#/organization/schema.ts";
import { handoff } from "#/organization/whatsapp-schema.ts";

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

/** Notifies every active admin of `content`. */
export function notifyAdmins(tx: Writer, content: NotificationContent) {
  notify(tx, activeWith(tx, ["admin"]), content);
}

/**
 * Notifies reception and the admins that `patientId`'s number asked to stop
 * getting messages, or, as `optOutReminder`, that nobody decided on them yet,
 * so a person turns their WhatsApp consent off or keeps it: each member once,
 * while their earlier notification of that kind about the patient is unread.
 */
export function notifyOptOut(tx: Writer, patientId: string, kind: "optOut" | "optOutReminder") {
  const unread = new Set(
    tx
      .select({ recipientId: notification.recipientId })
      .from(notification)
      .where(
        and(
          eq(notification.kind, kind),
          eq(notification.patientId, patientId),
          isNull(notification.readAt),
        ),
      )
      .all()
      .map((row) => row.recipientId),
  );
  const recipients = activeWith(tx, ["admin", "receptionist"]).filter((id) => !unread.has(id));
  notify(tx, recipients, { kind, patientId });
}

/**
 * `acting`'s notifications, unread first, each part newest first: an unread
 * one stays in the list however many came after it.
 */
export function listNotifications(database: Database, acting: Acting) {
  const rows = database
    .select({
      id: notification.id,
      kind: notification.kind,
      templateName: notification.templateName,
      templateVersion: notification.templateVersion,
      detail: notification.detail,
      until: notification.until,
      waiting: notification.waiting,
      notDeliveredIn: notification.conversationId,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      conversationId: handoff.conversationId,
      handoffReason: handoff.reason,
      handoffClinical: handoff.clinical,
      patientId: patient.id,
      firstName: patient.firstName,
      chosenName: patient.chosenName,
      lastName: patient.lastName,
    })
    .from(notification)
    .leftJoin(handoff, eq(handoff.id, notification.handoffId))
    .leftJoin(patient, eq(patient.id, notification.patientId))
    .where(eq(notification.recipientId, acting.userId))
    .orderBy(sql`${notification.readAt} is not null`, desc(notification.createdAt))
    .limit(notificationListSize)
    .all();
  return {
    ok: true,
    notifications: rows.map(
      ({
        readAt,
        notDeliveredIn,
        conversationId,
        handoffReason,
        handoffClinical,
        patientId,
        firstName,
        chosenName,
        lastName,
        ...row
      }) => ({
        ...row,
        read: readAt !== null,
        // The conversation of a handoff, or of a reply that was not delivered.
        conversationId: notDeliveredIn ?? conversationId,
        // A handoff's notification says what it was about and where, never the patient's words.
        handoff:
          conversationId !== null && handoffReason !== null
            ? { conversationId, reason: handoffReason, clinical: handoffClinical === true }
            : null,
        // An opt-out's names the patient whose consent to turn off, never the patient's words.
        patient:
          patientId !== null && firstName !== null && lastName !== null
            ? { id: patientId, name: patientName({ firstName, lastName, chosenName }) }
            : null,
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
