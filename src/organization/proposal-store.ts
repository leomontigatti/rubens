import { desc, eq, sql } from "drizzle-orm";

import { assistantUserId } from "#/lib/audit-fields.ts";
import type { HandoffDetail } from "#/lib/handoffs.ts";
import { present } from "#/lib/present.ts";
import { proposalExpiresAt } from "#/lib/proposals.ts";

import type { Upcoming } from "#/organization/assistant-appointments.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { lastIncomingAt } from "#/organization/whatsapp-messages.ts";
import { conversation, proposal } from "#/organization/whatsapp-schema.ts";

// A conversation's proposals as `proposals.ts` keeps them: who the assistant
// acts as, the turn a proposal is made in, and the latest one, the only one
// that can be accepted.

/**
 * The assistant as the change functions see it: it acts for every
 * practitioner, as reception does, on the appointments of the number's
 * patients only, which the turn's tools already narrowed.
 */
export const assistantActing: Acting = { userId: assistantUserId, roles: ["receptionist"] };

/** The conversation's latest proposal, the only one that can be accepted. */
export function latestProposal(database: Database, conversationId: string) {
  return (
    database
      .select()
      .from(proposal)
      .where(eq(proposal.conversationId, conversationId))
      // Insertion order breaks a tie: two proposals of a turn can share a millisecond.
      .orderBy(desc(proposal.createdAt), desc(sql`${proposal}.rowid`))
      .get()
  );
}

export type Stored = NonNullable<ReturnType<typeof latestProposal>>;

/**
 * The turn a proposal tool runs in: its conversation, its view of the
 * number's upcoming appointments, and where it records the appointment of a
 * move a rule refused, which underthing hands off, why, and the changes it
 * made, which that handoff's notification states.
 */
export interface ProposalTurn {
  conversationId: string;
  /** The patient's messages the turn reads as new, and the patients the number stands for. */
  read: { unjudged: { id: string }[]; patients: { id: string; firstName: string }[] };
  appointments: Upcoming[];
  recorded: {
    ruleRefused: string | null;
    refusal: HandoffDetail["refused"];
    applied: HandoffDetail["applied"];
    proposed: boolean;
  };
}

/** Stores a proposal as the conversation's latest, which the turn's reply states. */
export function storeProposal(
  database: Database,
  turn: ProposalTurn,
  values: Omit<typeof proposal.$inferInsert, "conversationId" | "expiresAt">,
) {
  const now = Date.now();
  database
    .insert(proposal)
    .values({
      ...values,
      conversationId: turn.conversationId,
      expiresAt: proposalExpiresAt(now, lastIncomingAt(database, turn.conversationId)),
      createdAt: now,
    })
    .run();
  turn.recorded.proposed = true;
}

/** The number of the proposal's conversation. */
export function phoneOf(database: Database, conversationId: string) {
  return present(
    database
      .select({ phone: conversation.phone })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get(),
    "A proposal's conversation is stored",
  ).phone;
}
