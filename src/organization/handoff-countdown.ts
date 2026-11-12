import { and, eq } from "drizzle-orm";

import { windowClosesAt } from "#/lib/conversation-window.ts";
import { defaultHandoffReminders, handoffRemindersSchema } from "#/lib/handoffs.ts";
import type { HandoffRemindersInput } from "#/lib/handoffs.ts";

import { recordAudit } from "#/organization/audit.ts";
import { returnAfterHours } from "#/organization/personal-replies.ts";
import type { Database, Writer } from "#/organization/database.ts";
import { readerOf } from "#/organization/inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { notify } from "#/organization/notifications.ts";
import { member } from "#/organization/schema.ts";
import {
  conversation,
  handoff,
  handoffRecipient,
  inboxSettings,
} from "#/organization/whatsapp-schema.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";

// A handoff's countdown (docs/domain/assistant.md § Handoff): one opened
// inside the window counts back from its close, which each later message
// from the patient moves. Its recipients are reminded some hours before the
// close, and a little later every other member who may answer it is too,
// for one to the practitioner only practitioners who keep clinical records. Each
// reminder goes once per close, by the object's alarm, and none after the
// close. The admin sets both times in the WhatsApp settings.

const hourMs = 60 * 60_000;

/** How many hours before the close each reminder goes, as the admin set them. */
export function handoffReminders(database: Writer) {
  const row = database
    .select({
      recipientHours: inboxSettings.handoffReminderHours,
      othersHours: inboxSettings.handoffWideReminderHours,
    })
    .from(inboxSettings)
    .get();
  return row ?? { ...defaultHandoffReminders };
}

export function saveHandoffReminders(
  database: Database,
  acting: Acting,
  input: HandoffRemindersInput,
) {
  const parsed = handoffRemindersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { recipientHours, othersHours } = parsed.data;
  const set = { handoffReminderHours: recipientHours, handoffWideReminderHours: othersHours };
  return database.transaction((tx) => {
    const before = handoffReminders(tx);
    tx.insert(inboxSettings)
      .values({ id: 1, returnAfterHours: returnAfterHours(tx), ...set })
      .onConflictDoUpdate({ target: inboxSettings.id, set: { ...set, updatedAt: Date.now() } })
      .run();
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "inboxSettings",
      entityId: "1",
      patientId: null,
      before,
      after: parsed.data,
    });
    return { ok: true as const };
  });
}

interface Countdown {
  id: string;
  conversationId: string;
  forPractitioner: boolean;
  closesAt: number;
  /** When its recipients' reminder goes; `null` when it went for this close, or fell before the handoff opened. */
  recipientsAt: number | null;
  /** When every other member's reminder goes; `null` when it went for this close. */
  othersAt: number | null;
  /** Whether the others' reminder fell before the handoff opened, whose recipients were just told. */
  othersOnly: boolean;
}

interface CountingHandoff {
  id: string;
  conversationId: string;
  forPractitioner: boolean;
  createdAt: number;
  remindedFor: number | null;
  widelyRemindedFor: number | null;
}

/** Whether a reminder went for the window closing at `closesAt`: an earlier close's does not count. */
function wentFor(remindedFor: number | null, closesAt: number) {
  return remindedFor !== null && remindedFor >= closesAt;
}

/** The reminders of `one` still to go before its window closes at `closesAt`. */
function countdownOf(
  one: CountingHandoff,
  closesAt: number,
  hours: ReturnType<typeof handoffReminders>,
): Countdown {
  const recipientsAt = closesAt - hours.recipientHours * hourMs;
  const othersAt = closesAt - hours.othersHours * hourMs;
  const recipientsDone = wentFor(one.remindedFor, closesAt) || recipientsAt <= one.createdAt;
  return {
    id: one.id,
    conversationId: one.conversationId,
    forPractitioner: one.forPractitioner,
    closesAt,
    recipientsAt: recipientsDone ? null : recipientsAt,
    othersAt: wentFor(one.widelyRemindedFor, closesAt) ? null : Math.max(othersAt, one.createdAt),
    othersOnly: othersAt <= one.createdAt,
  };
}

/** The open handoffs that count down, each with its reminders still to go before the window closes. */
function countdowns(database: Writer, now: number): Countdown[] {
  const hours = handoffReminders(database);
  const open = database
    .select({
      id: handoff.id,
      conversationId: handoff.conversationId,
      forPractitioner: handoff.forPractitioner,
      createdAt: handoff.createdAt,
      remindedFor: handoff.remindedFor,
      widelyRemindedFor: handoff.widelyRemindedFor,
    })
    .from(handoff)
    .where(and(eq(handoff.state, "open"), eq(handoff.countsDown, true)))
    .all();
  return open.flatMap((one) => {
    const closesAt = windowClosesAt(lastIncomingAt(database, one.conversationId));
    return closesAt !== null && closesAt > now ? [countdownOf(one, closesAt, hours)] : [];
  });
}

/** When the object's alarm should next fire for a reminder, or `null` when none is to go. */
export function nextReminderAlarm(database: Database): number | null {
  const due = countdowns(database, Date.now())
    .flatMap((one) => [one.recipientsAt, one.othersAt])
    .filter((at) => at !== null);
  return due.length > 0 ? Math.min(...due) : null;
}

/** The handoff's recipients who are still active members. */
function activeRecipients(database: Writer, handoffId: string) {
  return database
    .select({ memberId: handoffRecipient.memberId })
    .from(handoffRecipient)
    .innerJoin(member, eq(member.userId, handoffRecipient.memberId))
    .where(and(eq(handoffRecipient.handoffId, handoffId), eq(member.active, true)))
    .all()
    .map((row) => row.memberId);
}

/**
 * The active members who may answer the handoff: those who read its
 * conversation in the inbox, and for one to the practitioner only
 * practitioners who keep clinical records, the only ones who answer it.
 */
function mayAnswer(database: Database, countdown: Countdown) {
  const members = database
    .select({ userId: member.userId, roles: member.roles })
    .from(member)
    .where(eq(member.active, true))
    .all();
  return members
    .filter((acting) => {
      const reader = readerOf(database, acting);
      if (countdown.forPractitioner && !reader.keepsRecords) {
        return false;
      }
      const found = database
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.id, countdown.conversationId), reader.visible))
        .get();
      return found !== undefined;
    })
    .map((acting) => acting.userId);
}

function isDue(at: number | null, now: number) {
  return at !== null && at <= now;
}

/** Who a countdown's due reminders go to: its recipients, and every other member who may answer it. */
function remindedMembers(
  database: Database,
  countdown: Countdown,
  due: { recipients: boolean; others: boolean },
) {
  const recipients = activeRecipients(database, countdown.id);
  if (!due.others) {
    return recipients;
  }
  const others = mayAnswer(database, countdown).filter((id) => !recipients.includes(id));
  return due.recipients || !countdown.othersOnly ? [...recipients, ...others] : others;
}

/** Notifies `members` of the countdown's reminder, and records which close it went for. */
function remind(tx: Writer, countdown: Countdown, members: string[], othersToo: boolean) {
  notify(tx, members, {
    kind: "handoffReminder",
    handoffId: countdown.id,
    until: countdown.closesAt,
  });
  const closesAt = countdown.closesAt;
  tx.update(handoff)
    .set(
      othersToo
        ? { remindedFor: closesAt, widelyRemindedFor: closesAt }
        : { remindedFor: closesAt },
    )
    .where(eq(handoff.id, countdown.id))
    .run();
}

/** Sends each handoff reminder that is due: the object's alarm. */
export function sendDueReminders(database: Database) {
  const now = Date.now();
  for (const countdown of countdowns(database, now)) {
    const due = {
      recipients: isDue(countdown.recipientsAt, now),
      others: isDue(countdown.othersAt, now),
    };
    if (due.recipients || due.others) {
      const members = remindedMembers(database, countdown, due);
      database.transaction((tx) => remind(tx, countdown, members, due.others));
    }
  }
}
