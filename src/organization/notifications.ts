import { and, count, desc, eq, isNull } from "drizzle-orm";

import { notificationListSize, notificationReferenceSchema } from "#/lib/notifications.ts";
import type { NotificationReference } from "#/lib/notifications.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { member, notification } from "#/organization/schema.ts";

// Notifications to staff (`src/lib/notifications.ts`): written in the
// transaction of the event they tell of, one row per recipient, each read on
// its own. A member reads only their own.

type NotificationContent = Omit<
  typeof notification.$inferInsert,
  "id" | "recipientId" | "readAt" | "createdAt" | "updatedAt"
>;

/** Notifies every active admin of `content`. */
export function notifyAdmins(tx: Writer, content: NotificationContent) {
  const admins = tx
    .select({ userId: member.userId, roles: member.roles })
    .from(member)
    .where(eq(member.active, true))
    .all()
    .filter((row) => row.roles.includes("admin"));
  if (admins.length > 0) {
    tx.insert(notification)
      .values(admins.map(({ userId }) => ({ ...content, recipientId: userId })))
      .run();
  }
}

/** `acting`'s latest notifications, newest first. */
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
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(eq(notification.recipientId, acting.userId))
    .orderBy(desc(notification.createdAt))
    .limit(notificationListSize)
    .all();
  return {
    ok: true,
    notifications: rows.map(({ readAt, ...row }) => ({ ...row, read: readAt !== null })),
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
