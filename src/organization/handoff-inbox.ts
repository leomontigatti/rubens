import { and, desc, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";

import { handoffReferenceSchema, openHandoffListSchema } from "#/lib/handoffs.ts";
import type { HandoffReason, HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
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
  const handoffs: OpenHandoff[] = rows.map(({ heldReply, toReader, ...row }) => {
    const last = lastMessages.get(row.conversationId);
    return {
      ...row,
      // A recipient of a clinical handoff keeps clinical records (`handoffs.ts`).
      heldReply: toReader && reader.readsClinical ? heldReply : null,
      patients: patients.get(row.conversationId) ?? [],
      recipients: recipients.get(row.id) ?? [],
      lastPatientMessage: last ? asRead(last, reader.readsClinical) : null,
      mayClose: !row.clinical || reader.readsClinical,
    };
  });
  return { ok: true as const, handoffs };
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
  const parsed = handoffReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const reader = readerOf(database, acting);
  return database.transaction((tx) => {
    const found = tx
      .select({
        id: handoff.id,
        clinical: handoff.clinical,
        conversationId: handoff.conversationId,
      })
      .from(handoff)
      .innerJoin(conversation, eq(conversation.id, handoff.conversationId))
      .where(and(eq(handoff.id, parsed.data.handoffId), eq(handoff.state, "open"), reader.visible))
      .get();
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
  const parsed = handoffReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const reader = readerOf(database, acting);
  if (!reader.readsClinical) {
    return { ok: false as const, reason: "notFound" as const };
  }
  return database.transaction((tx) => {
    const dropped = tx
      .update(handoff)
      .set({ heldReply: null })
      .where(
        and(
          eq(handoff.id, parsed.data.handoffId),
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
