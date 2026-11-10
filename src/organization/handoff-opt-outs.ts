import { eq } from "drizzle-orm";

import { optOutReportSchema } from "#/lib/handoffs.ts";
import type { OptOutReport } from "#/lib/handoffs.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import { handoffInputOf, openHandoffSeen, shownAfter } from "#/organization/handoff-inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { holdForOptOut, optOutPendingSince } from "#/organization/opt-out-holds.ts";
import { patientsReachedAt } from "#/organization/whatsapp-messages.ts";
import { handoff } from "#/organization/whatsapp-schema.ts";

// An opt-out among a clinical handoff's words (docs/domain/assistant.md §
// The conversation window): reception cannot read them, and no code reads
// them in the model's place when the model could not, so the practitioner who
// reads them reports it. It holds the number and notifies reception and the
// admins as the assistant's opt-out does (`opt-out-holds.ts`), and reception
// decides per patient as for that one.

/**
 * Reports an opt-out that `acting`, a practitioner who keeps clinical
 * records, read among the words of an open clinical handoff, up to the
 * patient's message `throughMessageId`, the newest they were shown: holds
 * every patient of the number who accepts WhatsApp, notifying reception and
 * the admins of each, and leaves the handoff open. A report of no newer
 * message than the last one changes nothing, so reception's decision stands
 * until the patient writes again and a reader reports that.
 */
export function reportUnreadOptOut(database: Database, acting: Acting, input: OptOutReport) {
  const parsed = optOutReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const { throughMessageId } = parsed.data;
  const named = handoffInputOf(database, acting, parsed.data);
  if (!named.ok) {
    return named;
  }
  const { reader } = named;
  return database.transaction((tx) => {
    const found = openHandoffSeen(tx, reader, named.handoffId);
    if (!found?.clinical) {
      return { ok: false as const, reason: "notFound" as const };
    }
    if (!reader.readsClinical) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const { conversationId } = found;
    if (!shownAfter(tx, conversationId, throughMessageId, null)) {
      return { ok: false as const, reason: "notFound" as const };
    }
    if (!shownAfter(tx, conversationId, throughMessageId, found.optOutReportedThrough)) {
      return { ok: true as const };
    }
    const reached = patientsReachedAt(tx, found.phone).map((one) => one.id);
    const heldBefore = new Set(reached.filter((id) => optOutPendingSince(tx, id) !== null));
    const held = holdForOptOut(tx, reached);
    if (held.length === 0) {
      return { ok: false as const, reason: "nobodyToTurnOff" as const };
    }
    tx.update(handoff)
      .set({ optOutReportedThrough: throughMessageId })
      .where(eq(handoff.id, found.id))
      .run();
    for (const patientId of held.filter((id) => !heldBefore.has(id))) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "patient",
        entityId: patientId,
        patientId,
        before: { optOutPending: false },
        after: { optOutPending: true },
      });
    }
    return { ok: true as const };
  });
}
