import { desc, eq, sql } from "drizzle-orm";

import { assistantToolSchemas } from "#/lib/assistant.ts";
import { assistantUserId } from "#/lib/audit-fields.ts";
import { proposalExpiresAt } from "#/lib/proposals.ts";
import type { ProposalKind } from "#/lib/proposals.ts";

import type { AssistantTool } from "#/organization/assistant-model.ts";
import { upcomingAppointments, whenOf } from "#/organization/assistant-appointments.ts";
import type { Upcoming } from "#/organization/assistant-appointments.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/organization/appointment-changes.ts";
import type { Database } from "#/organization/database.ts";
import { openHandoffsOf } from "#/organization/handoffs.ts";
import type { Acting } from "#/organization/members.ts";
import { lastIncomingAt, patientsReachedAt } from "#/organization/whatsapp-messages.ts";
import { conversation, proposal } from "#/organization/whatsapp-schema.ts";

// Proposals (docs/domain/assistant.md § Proposals, ADR-0006 § The model
// interprets): the patient assistant's only way to change an appointment.
// A proposal states the change in full; accepting the conversation's latest,
// before it expires and while the appointment is as stated, runs the
// appointment's own change functions, so their rules hold and the change can
// still fail.

/**
 * The assistant as the change functions see it: it acts for every
 * practitioner, as reception does, on the appointments of the number's
 * patients only, which the turn's tools already narrowed.
 */
const assistantActing: Acting = { userId: assistantUserId, roles: ["receptionist"] };

/** The change as the patient reads it: the appointment, the practitioner, the date and the time. */
function stated(kind: ProposalKind, upcoming: Upcoming) {
  return {
    kind,
    medicalService: upcoming.medicalService,
    practitioner: upcoming.practitioner,
    ...whenOf(upcoming),
    office: upcoming.office,
  };
}

/** The conversation's latest proposal, the only one that can be accepted. */
function latestProposal(database: Database, conversationId: string) {
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

/** Makes the proposal's change through the appointment's own function. */
function applyChange(database: Database, kind: ProposalKind, appointmentId: string) {
  return kind === "confirm"
    ? changeAppointmentStatus(database, assistantActing, { appointmentId, status: "confirmed" })
    : cancelAppointment(database, assistantActing, { appointmentId, cancelledBy: "patient" });
}

/** The turn a proposal tool runs in: its conversation, and its view of the number's upcoming appointments. */
interface ProposalTurn {
  conversationId: string;
  appointments: Upcoming[];
}

/** Stores the proposal the model made, for an appointment of the turn's view only. */
function proposeChange(database: Database, turn: ProposalTurn, args: unknown) {
  const parsed = assistantToolSchemas.propose_change.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { appointmentId, kind } = parsed.data;
  const upcoming = turn.appointments.find((one) => one.id === appointmentId);
  if (!upcoming) {
    return { ok: false, reason: "notFound" };
  }
  const statement = stated(kind, upcoming);
  const now = Date.now();
  database
    .insert(proposal)
    .values({
      conversationId: turn.conversationId,
      appointmentId,
      kind,
      statement,
      expiresAt: proposalExpiresAt(now, lastIncomingAt(database, turn.conversationId)),
      createdAt: now,
    })
    .run();
  return { ok: true, proposal: statement };
}

/** Why the conversation's latest proposal cannot be accepted at `now`, or `null` when it can. */
function refusalOf(latest: ReturnType<typeof latestProposal>, now: number) {
  if (!latest) {
    return "noProposal";
  }
  if (latest.acceptedAt !== null) {
    return "alreadyAccepted";
  }
  return latest.expiresAt <= now ? "expired" : null;
}

/**
 * The appointment as it is now, while the conversation's number is still
 * the contact of its patient and it is still upcoming: read again at the
 * yes, since the turn's view dates from before the model ran.
 */
function appointmentNow(database: Database, conversationId: string, appointmentId: string) {
  const { phone } = database
    .select({ phone: conversation.phone })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get()!;
  const patientIds = patientsReachedAt(database, phone).map((one) => one.id);
  return upcomingAppointments(database, patientIds, Date.now()).find(
    (one) => one.id === appointmentId,
  );
}

/**
 * Accepts the conversation's latest proposal in one transaction: makes its
 * change while the appointment is as the patient was told, marks it
 * accepted, and updates the turn's view by that change alone.
 */
function acceptLatest(database: Database, turn: ProposalTurn) {
  return database.transaction(() => {
    const latest = latestProposal(database, turn.conversationId);
    const now = Date.now();
    const refusal = refusalOf(latest, now);
    if (refusal || !latest) {
      return { ok: false, reason: refusal };
    }
    const { appointments } = turn;
    const index = appointments.findIndex((one) => one.id === latest.appointmentId);
    const current = appointmentNow(database, turn.conversationId, latest.appointmentId);
    if (index === -1 || !current) {
      return { ok: false, reason: "notFound" };
    }
    // Moved, or its practitioner or office changed, since it was proposed.
    if (JSON.stringify(stated(latest.kind, current)) !== JSON.stringify(latest.statement)) {
      return { ok: false, reason: "changed" };
    }
    const changed = applyChange(database, latest.kind, current.id);
    if (!changed.ok) {
      return { ok: false, reason: changed.reason };
    }
    database.update(proposal).set({ acceptedAt: now }).where(eq(proposal.id, latest.id)).run();
    // Only the turn's own change: anything else changed meanwhile still holds its reply.
    if (latest.kind === "confirm") {
      appointments[index] = { ...appointments[index]!, status: "confirmed" };
    } else {
      appointments.splice(index, 1);
    }
    return { ok: true, applied: latest.statement };
  });
}

/**
 * The turn's proposal tools. `appointments` is the turn's view of the
 * number's upcoming appointments, which they act on only, and which an
 * accepted change updates in place, so the turn's reply is checked against
 * the state its own change left. Nothing is proposed or accepted while a
 * person holds the conversation.
 */
export function proposalTools(database: Database, turn: ProposalTurn): AssistantTool[] {
  const unlessHandedOff = (run: () => unknown) =>
    openHandoffsOf(database, turn.conversationId).length > 0
      ? { ok: false, reason: "handedOff" }
      : run();
  return [
    {
      name: "propose_change",
      run: (args) => unlessHandedOff(() => proposeChange(database, turn, args)),
    },
    { name: "accept_proposal", run: () => unlessHandedOff(() => acceptLatest(database, turn)) },
  ];
}
