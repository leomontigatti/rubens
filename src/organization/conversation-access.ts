import { and, eq, exists, isNotNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import type { Role } from "#/lib/access.ts";

import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { member, practitioner } from "#/organization/schema.ts";
import { conversation, handoff, handoffRecipient } from "#/organization/whatsapp-schema.ts";

// Conversation access (ADR-0013): who reads a WhatsApp conversation and who
// answers its handoffs. Reception and admins read every conversation; a
// practitioner only those handed to them. A handoff to reception is answered
// by whoever reads it; one to the practitioner only by a practitioner who
// keeps clinical records, or by whoever it went to because nobody active did.
// The forward questions (`readerOf`, `mayAnswer`) and the inverse one
// (`answerersOf`) are built from the same predicates below.

/** Who answers a handoff: a member, and whether they keep clinical records. */
export interface Answerer {
  memberId: string;
  keepsRecords: boolean;
}

/** How a member reads conversations, made once per call from their row. */
export interface Reader {
  /** The member's answerer, for `mayAnswer` and `mayUseHeldReply`. */
  answerer: Answerer;
  /** A predicate on `conversation`: undefined for reception and admins (every conversation). */
  visible: SQL | undefined;
}

/** A handoff, as the questions below take it. */
interface AskedHandoff {
  id: string;
  forPractitioner: boolean;
}

/** Whether a joined member row holds `role`. */
function holds(role: Role): SQL {
  return sql`exists (select 1 from json_each(${member.roles}) where value = ${role})`;
}

/**
 * Whether a member row, joined to its practitioner row, keeps clinical
 * records: the practitioner role, and the setting on the practitioner row the
 * role keeps after it is removed.
 */
export const keepsRecords = sql<boolean>`(${holds("practitioner")} and coalesce(${practitioner.keepsClinicalRecords}, 0) = 1)`;

/** Whether a handoff in the conversation went to `memberId`. */
function handedTo(database: Writer, memberId: string | typeof member.userId): SQL {
  return exists(
    database
      .select({ one: handoffRecipient.handoffId })
      .from(handoffRecipient)
      .innerJoin(handoff, eq(handoff.id, handoffRecipient.handoffId))
      .where(
        and(eq(handoff.conversationId, conversation.id), eq(handoffRecipient.memberId, memberId)),
      ),
  );
}

/** The row that says the handoff `handoffId` went to `memberId`, if it did. */
function recipientRow(
  database: Writer,
  handoffId: string,
  memberId: string | typeof member.userId,
) {
  return database
    .select({ one: handoffRecipient.memberId })
    .from(handoffRecipient)
    .where(and(eq(handoffRecipient.handoffId, handoffId), eq(handoffRecipient.memberId, memberId)));
}

/** How `acting` reads the inbox: which conversations, and as which answerer. */
export function readerOf(database: Writer, acting: Acting): Reader {
  const row = database
    .select({ practitionerId: practitioner.id, keepsRecords: keepsRecords.mapWith(Boolean) })
    .from(member)
    .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
    .where(eq(member.userId, acting.userId))
    .get();
  const answerer = { memberId: acting.userId, keepsRecords: row?.keepsRecords === true };
  if (actsForEveryone(acting)) {
    return { answerer, visible: undefined };
  }
  const ownPractitioner = acting.roles.includes("practitioner") && row?.practitionerId != null;
  return { answerer, visible: ownPractitioner ? handedTo(database, acting.userId) : sql`false` };
}

/**
 * Whether `answerer` may answer the handoff `one`, found through their
 * reader: any one to reception; one to the practitioner only when they keep
 * clinical records, or it went to them because nobody active did.
 */
export function mayAnswer(tx: Writer, one: AskedHandoff, answerer: Answerer): boolean {
  if (!one.forPractitioner || answerer.keepsRecords) {
    return true;
  }
  return recipientRow(tx, one.id, answerer.memberId).get() !== undefined;
}

/**
 * Whether `answerer` may use the held reply of the handoff `one`: on one to
 * the practitioner, only when they keep clinical records; on any other,
 * whenever they may answer it.
 */
export function mayUseHeldReply(tx: Writer, one: AskedHandoff, answerer: Answerer): boolean {
  return one.forPractitioner ? answerer.keepsRecords : mayAnswer(tx, one, answerer);
}

/** The active members who read the handoff's conversation and may answer it, in one query. */
export function answerersOf(tx: Writer, one: AskedHandoff & { conversationId: string }): string[] {
  const readsIt = or(
    holds("admin"),
    holds("receptionist"),
    and(holds("practitioner"), isNotNull(practitioner.id), handedTo(tx, member.userId)),
  );
  const answersIt = one.forPractitioner
    ? or(keepsRecords, exists(recipientRow(tx, one.id, member.userId)))
    : undefined;
  return tx
    .select({ memberId: member.userId })
    .from(member)
    .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
    .innerJoin(conversation, eq(conversation.id, one.conversationId))
    .where(and(eq(member.active, true), readsIt, answersIt))
    .all()
    .map((row) => row.memberId);
}
