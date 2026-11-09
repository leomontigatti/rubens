import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import { isWindowOpen } from "#/lib/conversation-window.ts";
import type { HandoffReason } from "#/lib/handoffs.ts";
import type { OutboxKind } from "#/lib/outbox.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { keepsRecords } from "#/organization/handoff-contacts.ts";
import { appointment, member, notification, practitioner } from "#/organization/schema.ts";
import {
  handoff,
  handoffRecipient,
  outboxMessage,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";

// Handoffs (docs/domain/assistant.md § Handoff): who a handoff goes to, and
// opening one with its notifications in one transaction. The assistant
// decides when (`assistant.ts`); the inbox lists and closes them
// (`handoff-inbox.ts`).

export interface HandoffWanted {
  reason: HandoffReason;
  clinical: boolean;
  /** The appointment it concerns, whose practitioner it goes to; `null` for none. */
  appointmentId: string | null;
  /** The assistant's reply the clinical check held, for a `heldReply` handoff. */
  heldReply?: string;
}

/**
 * The practitioner of `appointmentId`, when they can take the handoff: an
 * active member, and for a clinical one a practitioner who keeps clinical records.
 */
function practitionerFor(tx: Writer, appointmentId: string, clinical: boolean) {
  const found = tx
    .select({
      memberId: member.userId,
      active: member.active,
      keepsClinicalRecords: keepsRecords.mapWith(Boolean),
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!found?.active || (clinical && !found.keepsClinicalRecords)) {
    return null;
  }
  return found.memberId;
}

/**
 * The active handoff contacts, those who keep clinical records for a clinical
 * handoff. Before an admin picks any, every active admin takes a handoff, and
 * every active practitioner who keeps clinical records a clinical one.
 */
function contactsFor(tx: Writer, clinical: boolean) {
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
    .all()
    .filter((row) => !clinical || row.keepsClinicalRecords);
  const contacts = active.filter((row) => row.handoffContact);
  if (contacts.length > 0) {
    return contacts.map((row) => row.memberId);
  }
  return active.filter((row) => clinical || row.roles.includes("admin")).map((row) => row.memberId);
}

/** Who `wanted` goes to: the appointment's practitioner, else the handoff contacts. */
function recipientsOf(tx: Writer, wanted: HandoffWanted) {
  const own = wanted.appointmentId && practitionerFor(tx, wanted.appointmentId, wanted.clinical);
  return own ? [own] : contactsFor(tx, wanted.clinical);
}

/**
 * Opens a handoff of `conversationId`, and notifies each of its recipients at
 * once. One opened inside the window counts back from its close
 * (`handoff-countdown.ts`); one opened after it has no countdown.
 */
export function openHandoff(tx: Writer, conversationId: string, wanted: HandoffWanted) {
  const countsDown = isWindowOpen(lastIncomingAt(tx, conversationId), Date.now());
  const opened = tx
    .insert(handoff)
    .values({ conversationId, ...wanted, countsDown })
    .returning({ id: handoff.id })
    .get();
  const recipients = recipientsOf(tx, wanted);
  if (recipients.length > 0) {
    tx.insert(handoffRecipient)
      .values(recipients.map((memberId) => ({ handoffId: opened.id, memberId })))
      .run();
    tx.insert(notification)
      .values(
        recipients.map((recipientId) => ({
          recipientId,
          kind: "handoff" as const,
          handoffId: opened.id,
        })),
      )
      .run();
  }
  return opened.id;
}

/** The open handoffs of `conversationId`, each clinical or not. */
export function openHandoffsOf(database: Writer, conversationId: string) {
  return database
    .select({ id: handoff.id, clinical: handoff.clinical })
    .from(handoff)
    .where(and(eq(handoff.conversationId, conversationId), eq(handoff.state, "open")))
    .all();
}

/**
 * Whether `wanted` opens beside the conversation's open handoffs: always when
 * none is open; a clinical one when none open is clinical, so clinical words
 * reach someone who may read them; never a second of the same kind.
 */
export function addsToOpen(open: { clinical: boolean }[], wanted: HandoffWanted) {
  if (open.length === 0) {
    return true;
  }
  const clinicalOpen = open.some((handoff) => handoff.clinical);
  return wanted.clinical && !clinicalOpen;
}

/** The kinds of message from the organization whose answer the assistant sorts itself. */
const answeredKinds = ["followUp", "appointmentCancelled"] as const satisfies OutboxKind[];

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
  const kind = latest?.kind;
  if (!kind || !latest.appointmentId || !inArrayOf(answeredKinds, kind)) {
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

function inArrayOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
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
