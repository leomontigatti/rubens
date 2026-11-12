import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { reactionType } from "#/lib/reactions.ts";
import { handoffReferenceSchema, openHandoffListSchema } from "#/lib/handoffs.ts";
import type { HandoffReason, HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";
import type { MediaType } from "#/lib/whatsapp-messages.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import {
  addsToOpen,
  mayAnswer,
  openHandoffsOf,
  recipientsByHandoff,
  sendHandoff,
} from "#/organization/handoffs.ts";
import { asRead, messageColumns, patientsOf, readerOf } from "#/organization/inbox.ts";
import type { InboxMessage } from "#/organization/inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { answeredByPerson } from "#/organization/turn-retries.ts";
import {
  conversation,
  handoff,
  handoffRecipient,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";

// The open handoffs in the inbox (docs/domain/assistant.md § Handoff), read by
// the inbox's rules (`inbox.ts`): a member sees the handoffs of the
// conversations they read, with every word in them. Closing one without a
// reply is for whoever may answer it (`handoffs.ts`). Only a practitioner who
// keeps clinical records sends or fixes the reply the clinical check held;
// anyone who reads it drops that reply. Whoever reads a handoff to reception
// may pass it to the practitioner instead.

export interface OpenHandoff {
  id: string;
  conversationId: string;
  phone: string;
  patients: { id: string; name: string }[];
  reason: HandoffReason;
  /** Whether it needs the practitioner, rather than reception. */
  forPractitioner: boolean;
  /** For a `media` handoff, what the patient sent. */
  media: MediaType[];
  createdAt: number;
  /** Who it went to, by name. */
  recipients: string[];
  /** The patient's latest message. */
  lastPatientMessage: InboxMessage | null;
  /** Whether the reader may answer it, and so close it without a reply. */
  mayAnswer: boolean;
  /** Whether the reader may send or fix its held reply: a practitioner who keeps clinical records. */
  mayUseHeldReply: boolean;
  /** Whether the reader may pass it to the practitioner: one to reception, with none to the practitioner open beside it. */
  mayPass: boolean;
  /** The assistant's reply the clinical check held; `null` when it holds none. */
  heldReply: string | null;
}

/** The latest message from the patient in each of `conversationIds`. */
function lastPatientMessages(database: Database, conversationIds: string[]) {
  const rows =
    conversationIds.length === 0
      ? []
      : database
          .select(messageColumns)
          .from(whatsappMessage)
          .where(
            and(
              inArray(whatsappMessage.conversationId, conversationIds),
              eq(whatsappMessage.direction, "incoming"),
              // A reaction says nothing of what the handoff is about.
              ne(whatsappMessage.type, reactionType),
            ),
          )
          .orderBy(desc(whatsappMessage.sentAt), desc(sql`${whatsappMessage}.rowid`))
          .all();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.conversationId)) {
      latest.set(row.conversationId, row);
    }
  }
  return latest;
}

/** The open handoffs `acting` sees, newest first, of one conversation when `conversationId` says. */
export function listOpenHandoffs(
  database: Database,
  acting: Acting,
  input: OpenHandoffListOptions,
) {
  const parsed = openHandoffListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { conversationId } = parsed.data;
  const reader = readerOf(database, acting);
  const rows = database
    .select({
      id: handoff.id,
      conversationId: handoff.conversationId,
      phone: conversation.phone,
      reason: handoff.reason,
      forPractitioner: handoff.forPractitioner,
      createdAt: handoff.createdAt,
      heldReply: handoff.heldReply,
      detail: handoff.detail,
    })
    .from(handoff)
    .innerJoin(conversation, eq(conversation.id, handoff.conversationId))
    .where(
      and(
        eq(handoff.state, "open"),
        reader.visible,
        conversationId === undefined ? undefined : eq(handoff.conversationId, conversationId),
      ),
    )
    .orderBy(desc(handoff.createdAt), desc(sql`${handoff}.rowid`))
    .all();
  const conversationIds = [...new Set(rows.map((row) => row.conversationId))];
  const patients = patientsOf(database, conversationIds);
  const recipients = recipientsByHandoff(
    database,
    rows.map((row) => row.id),
  );
  const lastMessages = lastPatientMessages(database, conversationIds);
  const withPractitioner = new Set(
    rows.filter((row) => row.forPractitioner).map((row) => row.conversationId),
  );
  const member = { memberId: acting.userId, keepsRecords: reader.keepsRecords };
  const handoffs: OpenHandoff[] = rows.map(({ detail, ...row }) => {
    const last = lastMessages.get(row.conversationId);
    return {
      ...row,
      media: detail?.media ?? [],
      patients: patients.get(row.conversationId) ?? [],
      recipients: recipients.get(row.id) ?? [],
      lastPatientMessage: last ? asRead(last) : null,
      mayAnswer: mayAnswer(database, row, member),
      mayUseHeldReply: reader.keepsRecords,
      mayPass: !row.forPractitioner && !withPractitioner.has(row.conversationId),
    };
  });
  return { ok: true as const, handoffs };
}

/** The handoff `input` names, with what `acting` reads, or why the input is refused. */
function handoffInputOf(database: Database, acting: Acting, input: HandoffReference) {
  const parsed = handoffReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  return {
    ok: true as const,
    handoffId: parsed.data.handoffId,
    reader: readerOf(database, acting),
  };
}

/** The open handoff `handoffId`, if `reader` sees it. */
function openHandoffSeen(tx: Writer, reader: ReturnType<typeof readerOf>, handoffId: string) {
  return tx
    .select({
      id: handoff.id,
      forPractitioner: handoff.forPractitioner,
      appointmentId: handoff.appointmentId,
      conversationId: handoff.conversationId,
    })
    .from(handoff)
    .innerJoin(conversation, eq(conversation.id, handoff.conversationId))
    .where(and(eq(handoff.id, handoffId), eq(handoff.state, "open"), reader.visible))
    .get();
}

/**
 * Closes one of the open handoffs `acting` sees and may answer without a
 * reply, recording who closed it; one closed already, or not seen, is not found.
 */
export function closeHandoffWithoutReply(
  database: Database,
  acting: Acting,
  input: HandoffReference,
) {
  const named = handoffInputOf(database, acting, input);
  if (!named.ok) {
    return named;
  }
  const { reader } = named;
  return database.transaction((tx) => {
    const found = openHandoffSeen(tx, reader, named.handoffId);
    if (!found) {
      return { ok: false as const, reason: "notFound" as const };
    }
    if (!mayAnswer(tx, found, { memberId: acting.userId, keepsRecords: reader.keepsRecords })) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    tx.update(handoff)
      .set({ state: "closed", closedAt: Date.now(), closedBy: acting.userId, heldReply: null })
      .where(eq(handoff.id, found.id))
      .run();
    // Closed with nothing left to answer: the words it saw are answered.
    answeredByPerson(tx, found.conversationId, Date.now());
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "handoff",
      entityId: found.id,
      patientId: null,
      before: { state: "open" },
      after: { state: "closed" },
    });
    return { ok: true as const };
  });
}

/**
 * Passes one of the open handoffs to reception `acting` sees to the
 * practitioner: it goes where a handoff to the practitioner goes, whose
 * recipients are notified and reminded in its place. Refused while one to the
 * practitioner is open in its conversation; one closed already, or not seen,
 * is not found. The patient is told nothing.
 */
export function passHandoffToPractitioner(
  database: Database,
  acting: Acting,
  input: HandoffReference,
) {
  const named = handoffInputOf(database, acting, input);
  if (!named.ok) {
    return named;
  }
  return database.transaction((tx) => {
    const found = openHandoffSeen(tx, named.reader, named.handoffId);
    if (!found || found.forPractitioner) {
      return { ok: false as const, reason: "notFound" as const };
    }
    const wanted = { forPractitioner: true, appointmentId: found.appointmentId };
    if (!addsToOpen(openHandoffsOf(tx, found.conversationId), wanted)) {
      return { ok: false as const, reason: "withPractitioner" as const };
    }
    tx.update(handoff)
      .set({ forPractitioner: true, remindedFor: null, widelyRemindedFor: null })
      .where(eq(handoff.id, found.id))
      .run();
    tx.delete(handoffRecipient).where(eq(handoffRecipient.handoffId, found.id)).run();
    sendHandoff(tx, found.id, wanted);
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "handoff",
      entityId: found.id,
      patientId: null,
      before: { forPractitioner: false },
      after: { forPractitioner: true },
    });
    return { ok: true as const };
  });
}

/**
 * Drops the reply the clinical check held on one of the open handoffs
 * `acting` sees, leaving the handoff open; a handoff with none, or not seen,
 * is not found. The audit records the drop, never the words.
 */
export function dropHandoffHeldReply(database: Database, acting: Acting, input: HandoffReference) {
  const named = handoffInputOf(database, acting, input);
  if (!named.ok) {
    return named;
  }
  return database.transaction((tx) => {
    const found = openHandoffSeen(tx, named.reader, named.handoffId);
    const dropped =
      found &&
      tx
        .update(handoff)
        .set({ heldReply: null })
        .where(and(eq(handoff.id, found.id), isNotNull(handoff.heldReply)))
        .returning({ id: handoff.id })
        .get();
    if (!dropped) {
      return { ok: false as const, reason: "notFound" as const };
    }
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "handoff",
      entityId: dropped.id,
      patientId: null,
      before: { heldReply: "held" },
      after: { heldReply: null },
    });
    return { ok: true as const };
  });
}
