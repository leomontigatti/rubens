import { and, desc, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";

import { handoffReferenceSchema, openHandoffListSchema } from "#/lib/handoffs.ts";
import type { HandoffReason, HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import { recipientsByHandoff } from "#/organization/handoffs.ts";
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
// conversations they read, a clinical one included, never words they may not
// read. Closing one without a reply is for whoever may answer it: for a
// clinical one, a practitioner who keeps clinical records. A reply the
// clinical check held is read, and dropped, only by the handoff's recipients.
// An opt-out among a clinical handoff's words is reported to reception by
// whoever reads them (`handoff-opt-outs.ts`).

export interface OpenHandoff {
  id: string;
  conversationId: string;
  phone: string;
  patients: { id: string; name: string }[];
  reason: HandoffReason;
  clinical: boolean;
  createdAt: number;
  /** Who it went to, by name. */
  recipients: string[];
  /** The patient's latest message, as the reader may see it. */
  lastPatientMessage: InboxMessage | null;
  /** Whether the reader may close it without a reply. */
  mayClose: boolean;
  /** The assistant's reply the clinical check held, for its recipients only; `null` for anyone else. */
  heldReply: string | null;
  /**
   * On a clinical handoff, for a reader of its words: whether they may
   * report an opt-out among them to reception, which cannot read them, or
   * did already for every message the patient sent; `null` for anyone else.
   */
  optOut: "mayReport" | "reported" | null;
}

/** Whether `memberId` is one of the handoff's recipients. */
function isRecipient(memberId: string) {
  return and(eq(handoffRecipient.handoffId, handoff.id), eq(handoffRecipient.memberId, memberId));
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

/**
 * Messages after `messageId` in the order the inbox shows them, by when
 * the patient sent them, then by when they were stored: as
 * `lastPatientMessages` picks the latest.
 */
function laterThan(messageId: string) {
  return sql`(${whatsappMessage.sentAt}, ${whatsappMessage}.rowid) > (
    select seen.sent_at, seen.rowid from whatsapp_message as seen where seen.id = ${messageId}
  )`;
}

/**
 * Whether `messageId`, a message of the patient in `conversationId`, comes
 * after `throughId` in the inbox's order; any comes after none.
 */
export function shownAfter(
  database: Writer,
  conversationId: string,
  messageId: string,
  throughId: string | null,
) {
  const found = database
    .select({ id: whatsappMessage.id })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.id, messageId),
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
        throughId === null ? undefined : laterThan(throughId),
      ),
    )
    .get();
  return found !== undefined;
}

/**
 * Whether an opt-out reported on a handoff of `conversationId`, through
 * the patient's message `throughId`, covers every message the patient sent:
 * one shown after it may ask to stop again, after reception decided.
 */
function optOutReportCovers(database: Writer, conversationId: string, throughId: string | null) {
  if (throughId === null) {
    return false;
  }
  const later = database
    .select({ id: whatsappMessage.id })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
        laterThan(throughId),
      ),
    )
    .get();
  return later === undefined;
}

function optOutOf(clinical: boolean, readsClinical: boolean, covered: () => boolean) {
  if (!clinical || !readsClinical) {
    return null;
  }
  return covered() ? ("reported" as const) : ("mayReport" as const);
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
      clinical: handoff.clinical,
      createdAt: handoff.createdAt,
      heldReply: handoff.heldReply,
      optOutReportedThrough: handoff.optOutReportedThrough,
      toReader: exists(
        database
          .select({ one: handoffRecipient.memberId })
          .from(handoffRecipient)
          .where(isRecipient(acting.userId)),
      ).mapWith(Boolean),
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
  const handoffs: OpenHandoff[] = rows.map(
    ({ heldReply, toReader, optOutReportedThrough, ...row }) => {
      const last = lastMessages.get(row.conversationId);
      return {
        ...row,
        // A recipient of a clinical handoff keeps clinical records (`handoffs.ts`).
        heldReply: toReader && reader.readsClinical ? heldReply : null,
        patients: patients.get(row.conversationId) ?? [],
        recipients: recipients.get(row.id) ?? [],
        lastPatientMessage: last ? asRead(last, reader.readsClinical) : null,
        mayClose: !row.clinical || reader.readsClinical,
        optOut: optOutOf(row.clinical, reader.readsClinical, () =>
          optOutReportCovers(database, row.conversationId, optOutReportedThrough),
        ),
      };
    },
  );
  return { ok: true as const, handoffs };
}

/** The handoff `input` names, with what `acting` reads, or why the input is refused. */
export function handoffInputOf(database: Database, acting: Acting, input: HandoffReference) {
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
export function openHandoffSeen(
  tx: Writer,
  reader: ReturnType<typeof readerOf>,
  handoffId: string,
) {
  return tx
    .select({
      id: handoff.id,
      clinical: handoff.clinical,
      conversationId: handoff.conversationId,
      phone: conversation.phone,
      optOutReportedThrough: handoff.optOutReportedThrough,
    })
    .from(handoff)
    .innerJoin(conversation, eq(conversation.id, handoff.conversationId))
    .where(and(eq(handoff.id, handoffId), eq(handoff.state, "open"), reader.visible))
    .get();
}

/**
 * Closes one of the open handoffs `acting` sees without a reply, recording
 * who closed it. A clinical one is closed only by a practitioner who keeps
 * clinical records; one closed already, or not seen, is not found.
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
    if (found.clinical && !reader.readsClinical) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    tx.update(handoff)
      .set({ state: "closed", closedAt: Date.now(), closedBy: acting.userId, heldReply: null })
      .where(eq(handoff.id, found.id))
      .run();
    // Closed with nothing left to answer: the words it saw are answered.
    if (reader.readsClinical) {
      answeredByPerson(tx, found.conversationId, Date.now());
    }
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
 * Drops the reply the clinical check held on one of the open handoffs
 * `acting` is a recipient of, leaving the handoff open; a handoff with none,
 * or not theirs, is not found. The audit records the drop, never the words.
 */
export function dropHandoffHeldReply(database: Database, acting: Acting, input: HandoffReference) {
  const named = handoffInputOf(database, acting, input);
  if (!named.ok) {
    return named;
  }
  if (!named.reader.readsClinical) {
    return { ok: false as const, reason: "notFound" as const };
  }
  return database.transaction((tx) => {
    const dropped = tx
      .update(handoff)
      .set({ heldReply: null })
      .where(
        and(
          eq(handoff.id, named.handoffId),
          eq(handoff.state, "open"),
          isNotNull(handoff.heldReply),
          exists(
            tx
              .select({ one: handoffRecipient.memberId })
              .from(handoffRecipient)
              .where(isRecipient(acting.userId)),
          ),
        ),
      )
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
