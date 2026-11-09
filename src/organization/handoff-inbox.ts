import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { handoffReferenceSchema, openHandoffListSchema } from "#/lib/handoffs.ts";
import type { HandoffReason, HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import { recipientsByHandoff } from "#/organization/handoffs.ts";
import { asRead, messageColumns, patientsOf, readerOf } from "#/organization/inbox.ts";
import type { InboxMessage } from "#/organization/inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { conversation, handoff, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The open handoffs in the inbox (docs/domain/assistant.md § Handoff), read by
// the inbox's rules (`inbox.ts`): a member sees the handoffs of the
// conversations they read, a clinical one included, never words they may not
// read. Closing one without a reply is for whoever may answer it: for a
// clinical one, a practitioner who keeps clinical records.

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
  const handoffs: OpenHandoff[] = rows.map((row) => {
    const last = lastMessages.get(row.conversationId);
    return {
      ...row,
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
      .select({ id: handoff.id, clinical: handoff.clinical })
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
      .set({ state: "closed", closedAt: Date.now(), closedBy: acting.userId })
      .where(eq(handoff.id, found.id))
      .run();
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
