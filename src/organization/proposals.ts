import { desc, eq, sql } from "drizzle-orm";

import { assistantToolSchemas } from "#/lib/assistant.ts";
import { assistantUserId } from "#/lib/audit-fields.ts";
import { proposalExpiresAt } from "#/lib/proposals.ts";
import type { MoveRefusal, ProposalKind } from "#/lib/proposals.ts";

import type { AssistantTool } from "#/organization/assistant-model.ts";
import { upcomingAppointments, whenOf } from "#/organization/assistant-appointments.ts";
import type { Upcoming } from "#/organization/assistant-appointments.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/organization/appointment-changes.ts";
import type { Database } from "#/organization/database.ts";
import { openHandoffsOf } from "#/organization/handoffs.ts";
import type { Acting } from "#/organization/members.ts";
import { freeTimesFor, movePatientAppointment, slotFor } from "#/organization/moves.ts";
import type { Slot } from "#/organization/moves.ts";
import { isHeld, lastIncomingAt, patientsReachedAt } from "#/organization/whatsapp-messages.ts";
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

/** A move's new time as the patient reads it, beside the appointment's facts. */
function statedMove(slot: Slot) {
  return { newDate: slot.date, newTime: slot.time, newOffice: slot.office };
}

/** Makes the proposal's change through the appointment's own function. */
function applyChange(database: Database, latest: NonNullable<ReturnType<typeof latestProposal>>) {
  const { appointmentId } = latest;
  if (latest.kind === "move") {
    const { newDate, newTime, newOffice } = latest.statement;
    return movePatientAppointment(database, assistantActing, {
      appointmentId,
      stated: {
        slotId: new Date(latest.startsAt!).toISOString(),
        date: newDate!,
        time: newTime!,
        office: newOffice!,
      },
    });
  }
  return latest.kind === "confirm"
    ? changeAppointmentStatus(database, assistantActing, { appointmentId, status: "confirmed" })
    : cancelAppointment(database, assistantActing, { appointmentId, cancelledBy: "patient" });
}

/**
 * The turn a proposal tool runs in: its conversation, its view of the
 * number's upcoming appointments, and where it records the appointment of a
 * move a rule refused, which underthing hands off.
 */
interface ProposalTurn {
  conversationId: string;
  appointments: Upcoming[];
  recorded: { ruleRefused: string | null };
}

/** Returns a refusal, noting a move a rule refused for the turn's handoff. */
function refused(turn: ProposalTurn, appointmentId: string, reason: string) {
  const rules: string[] = ["pastCutoff", "moveUsed"] satisfies MoveRefusal[];
  if (rules.includes(reason)) {
    turn.recorded.ruleRefused = appointmentId;
  }
  return { ok: false, reason };
}

/** The free times the appointment can move to, for an appointment of the turn's view only. */
function findFreeTimes(database: Database, turn: ProposalTurn, args: unknown) {
  const parsed = assistantToolSchemas.find_free_times.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { appointmentId, from } = parsed.data;
  const upcoming = turn.appointments.find((one) => one.id === appointmentId);
  if (!upcoming) {
    return { ok: false, reason: "notFound" };
  }
  const found = freeTimesFor(database, appointmentId, from);
  if (!found.ok) {
    return refused(turn, appointmentId, found.reason);
  }
  return {
    ok: true,
    practitioner: upcoming.practitioner,
    medicalService: upcoming.medicalService,
    slots: found.slots,
    more: found.more,
  };
}

/** Stores the proposal the model made, for an appointment of the turn's view only. */
function proposeChange(database: Database, turn: ProposalTurn, args: unknown) {
  const parsed = assistantToolSchemas.propose_change.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { appointmentId, kind, slotId } = parsed.data;
  const upcoming = turn.appointments.find((one) => one.id === appointmentId);
  if (!upcoming) {
    return { ok: false, reason: "notFound" };
  }
  let move: Slot | null = null;
  if (kind === "move") {
    const found = slotId === undefined ? null : slotFor(database, appointmentId, slotId);
    if (!found) {
      return { ok: false, reason: "invalidInput" };
    }
    if (!found.ok) {
      return refused(turn, appointmentId, found.reason);
    }
    move = found.slot;
  }
  const statement = { ...stated(kind, upcoming), ...(move && statedMove(move)) };
  const now = Date.now();
  database
    .insert(proposal)
    .values({
      conversationId: turn.conversationId,
      appointmentId,
      kind,
      statement,
      startsAt: move && Date.parse(move.slotId),
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
    const asNow = Object.entries(stated(latest.kind, current));
    if (asNow.some(([key, value]) => latest.statement[key] !== value)) {
      return { ok: false, reason: "changed" };
    }
    const changed = applyChange(database, latest);
    if (!changed.ok) {
      return refused(turn, current.id, changed.reason);
    }
    database.update(proposal).set({ acceptedAt: now }).where(eq(proposal.id, latest.id)).run();
    // Only the turn's own change: anything else changed meanwhile still holds its reply.
    if (latest.kind === "confirm") {
      appointments[index] = { ...appointments[index]!, status: "confirmed" };
    } else if (latest.kind === "move") {
      appointments[index] = appointmentNow(database, turn.conversationId, current.id)!;
      // As upcomingAppointments orders them, so the reply's check compares like with like.
      appointments.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
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
  // A person answers while a handoff is open or a member holds the conversation.
  const unlessHandedOff = (run: () => unknown) =>
    openHandoffsOf(database, turn.conversationId).length > 0 ||
    isHeld(database, turn.conversationId)
      ? { ok: false, reason: "handedOff" }
      : run();
  return [
    { name: "find_free_times", run: (args) => findFreeTimes(database, turn, args) },
    {
      name: "propose_change",
      run: (args) => unlessHandedOff(() => proposeChange(database, turn, args)),
    },
    { name: "accept_proposal", run: () => unlessHandedOff(() => acceptLatest(database, turn)) },
  ];
}
