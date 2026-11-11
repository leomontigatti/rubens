import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import { isWindowOpen } from "#/lib/conversation-window.ts";
import type { HandoffDetail, HandoffReason } from "#/lib/handoffs.ts";
import { attendedTimings } from "#/lib/template-timing.ts";
import type { TimingKind } from "#/lib/template-timing.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { keepsRecords } from "#/organization/handoff-contacts.ts";
import { notify } from "#/organization/notifications.ts";
import { appointment, member, practitioner } from "#/organization/schema.ts";
import {
  handoff,
  handoffRecipient,
  outboxMessage,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";

// Handoffs (docs/domain/assistant.md § Handoff): who a handoff goes to, and
// opening one with its notifications in one transaction. One that needs the
// practitioner goes to a practitioner who keeps clinical records, any other
// to reception. The assistant decides when (`assistant.ts`); the inbox lists
// them, passes one to the practitioner and closes them (`handoff-inbox.ts`).

export interface HandoffWanted {
  reason: HandoffReason;
  /** Whether it needs the practitioner, rather than reception. */
  forPractitioner: boolean;
  /** The appointment it concerns; its practitioner takes it when it needs one. `null` for none. */
  appointmentId: string | null;
  /** The assistant's reply the clinical check held, for a `heldReply` handoff. */
  heldReply?: string;
  /** What the turn knew of a refused move and its own changes, for the notification. */
  detail?: HandoffDetail | null;
}

/**
 * The practitioner of `appointmentId`, with the name patients read, when they
 * can take a handoff to the practitioner: an active member who keeps clinical records.
 */
function practitionerFor(tx: Writer, appointmentId: string) {
  const found = tx
    .select({
      memberId: member.userId,
      name: practitioner.displayName,
      active: member.active,
      keepsClinicalRecords: keepsRecords.mapWith(Boolean),
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(eq(appointment.id, appointmentId))
    .get();
  return found?.active && found.keepsClinicalRecords ? found : null;
}

/**
 * The active handoff contacts, those who keep clinical records for a handoff
 * to the practitioner. Before an admin picks any, every active practitioner
 * who keeps clinical records takes a handoff to the practitioner, and every
 * active admin any other, and one to the practitioner when nobody keeps
 * clinical records.
 */
function contactsFor(tx: Writer, forPractitioner: boolean) {
  const active = tx
    .select({
      memberId: member.userId,
      roles: member.roles,
      handoffContact: member.handoffContact,
      keepsClinicalRecords: keepsRecords.mapWith(Boolean),
    })
    .from(member)
    .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
    .where(eq(member.active, true))
    .all();
  const eligible = active.filter((row) => !forPractitioner || row.keepsClinicalRecords);
  const contacts = eligible.filter((row) => row.handoffContact);
  const chosen = contacts.length > 0 || !forPractitioner ? contacts : eligible;
  if (chosen.length > 0) {
    return chosen.map((row) => row.memberId);
  }
  return active.filter((row) => row.roles.includes("admin")).map((row) => row.memberId);
}

/**
 * Who `wanted` goes to: for the practitioner, the appointment's, by the name
 * patients read, else the handoff contacts who keep clinical records; any
 * other to the handoff contacts.
 */
function recipientsOf(tx: Writer, wanted: Omit<HandoffWanted, "reason">) {
  const own =
    wanted.forPractitioner && wanted.appointmentId
      ? practitionerFor(tx, wanted.appointmentId)
      : null;
  return own
    ? { memberIds: [own.memberId], practitioner: own.name }
    : { memberIds: contactsFor(tx, wanted.forPractitioner), practitioner: null };
}

/**
 * Sends the handoff `handoffId` to the recipients `wanted` goes to, and
 * notifies each at once; says the appointment's practitioner by the name
 * patients read when it went to them.
 */
export function sendHandoff(
  tx: Writer,
  handoffId: string,
  wanted: Omit<HandoffWanted, "reason">,
) {
  const recipients = recipientsOf(tx, wanted);
  if (recipients.memberIds.length > 0) {
    tx.insert(handoffRecipient)
      .values(recipients.memberIds.map((memberId) => ({ handoffId, memberId })))
      .run();
    notify(tx, recipients.memberIds, { kind: "handoff", handoffId });
  }
  return recipients.practitioner;
}

/**
 * Opens a handoff of `conversationId`, and notifies each of its recipients at
 * once. One opened inside the window counts back from its close
 * (`handoff-countdown.ts`); one opened after it has no countdown. Says the
 * practitioner it went to, by the name patients read, when it went to the
 * appointment's.
 */
export function openHandoff(tx: Writer, conversationId: string, wanted: HandoffWanted) {
  const countsDown = isWindowOpen(lastIncomingAt(tx, conversationId), Date.now());
  const opened = tx
    .insert(handoff)
    .values({ conversationId, ...wanted, countsDown })
    .returning({ id: handoff.id })
    .get();
  return { id: opened.id, practitioner: sendHandoff(tx, opened.id, wanted) };
}

/** The open handoffs of `conversationId`, each for the practitioner or not. */
export function openHandoffsOf(database: Writer, conversationId: string) {
  return database
    .select({
      id: handoff.id,
      reason: handoff.reason,
      forPractitioner: handoff.forPractitioner,
      createdAt: handoff.createdAt,
    })
    .from(handoff)
    .where(and(eq(handoff.conversationId, conversationId), eq(handoff.state, "open")))
    .all();
}

/**
 * Whether `wanted` opens beside the conversation's open handoffs: unless one
 * of its kind, for the practitioner or for reception, is open already.
 */
export function addsToOpen(
  open: { forPractitioner: boolean }[],
  wanted: Pick<HandoffWanted, "forPractitioner">,
) {
  return !open.some((handoff) => handoff.forPractitioner === wanted.forPractitioner);
}

/**
 * What a message from the organization is, when the assistant sorts its
 * answer itself: a template timed on or after the appointment's attendance,
 * which asks how the patient is, or the cancellation of an appointment.
 */
function answeredKind(kind: string | null, timing: TimingKind | null) {
  if (kind === "appointmentCancelled") {
    return "appointmentCancelled" as const;
  }
  if (kind === "timed" && timing && (attendedTimings as readonly TimingKind[]).includes(timing)) {
    return "followUp" as const;
  }
  return null;
}

/**
 * The message from the organization the patient's new messages answer: the
 * conversation's latest outgoing one before them, when it is a follow-up or
 * the cancellation of an appointment, with that appointment, whose
 * practitioner a handoff then goes to. `firstReply` says no turn judged a
 * reply to it yet: only that turn sorts a follow-up's answer.
 */
export function answeredMessage(database: Database, conversationId: string, before: number) {
  const latest = database
    .select({
      kind: outboxMessage.kind,
      timing: outboxMessage.timing,
      appointmentId: outboxMessage.appointmentId,
      sentAt: whatsappMessage.sentAt,
    })
    .from(whatsappMessage)
    .leftJoin(outboxMessage, eq(outboxMessage.whatsappMessageId, whatsappMessage.id))
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "outgoing"),
        lt(whatsappMessage.sentAt, before),
      ),
    )
    .orderBy(desc(whatsappMessage.sentAt))
    .limit(1)
    .get();
  const kind = latest ? answeredKind(latest.kind, latest.timing) : null;
  if (!kind || !latest?.appointmentId) {
    return null;
  }
  const judgedSince = database
    .select({ id: whatsappMessage.id })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
        isNotNull(whatsappMessage.judgement),
        gte(whatsappMessage.sentAt, latest.sentAt),
      ),
    )
    .get();
  return { kind, appointmentId: latest.appointmentId, firstReply: !judgedSince };
}

/**
 * Whether `memberId` may answer the handoff `one`: any one to reception;
 * one to the practitioner only when they keep clinical records, or it went
 * to them because nobody active did.
 */
export function mayAnswer(
  tx: Writer,
  one: { id: string; forPractitioner: boolean },
  member: { memberId: string; keepsRecords: boolean },
) {
  if (!one.forPractitioner || member.keepsRecords) {
    return true;
  }
  const recipient = tx
    .select({ one: handoffRecipient.memberId })
    .from(handoffRecipient)
    .where(
      and(eq(handoffRecipient.handoffId, one.id), eq(handoffRecipient.memberId, member.memberId)),
    )
    .get();
  return recipient !== undefined;
}

/** Every recipient of `handoffIds`, by handoff. */
export function recipientsByHandoff(database: Database, handoffIds: string[]) {
  const rows =
    handoffIds.length === 0
      ? []
      : database
          .select({ handoffId: handoffRecipient.handoffId, name: member.name })
          .from(handoffRecipient)
          .innerJoin(member, eq(member.userId, handoffRecipient.memberId))
          .where(inArray(handoffRecipient.handoffId, handoffIds))
          .orderBy(member.name)
          .all();
  const byHandoff = new Map<string, string[]>();
  for (const row of rows) {
    byHandoff.set(row.handoffId, [...(byHandoff.get(row.handoffId) ?? []), row.name]);
  }
  return byHandoff;
}
