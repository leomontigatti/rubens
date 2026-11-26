import { desc, eq, sql } from "drizzle-orm";

import { assistantToolSchemas } from "#/lib/assistant.ts";
import { assistantUserId } from "#/lib/audit-fields.ts";
import { formatDay, formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { proposalExpiresAt } from "#/lib/proposals.ts";
import type { HandoffDetail } from "#/lib/handoffs.ts";
import { present } from "#/lib/present.ts";
import type { MoveRefusal, ProposalKind } from "#/lib/proposals.ts";

import type { AssistantTool, ToolResult } from "#/organization/assistant-model.ts";
import { upcomingAppointments, whenOf } from "#/organization/assistant-appointments.ts";
import type { Upcoming } from "#/organization/assistant-appointments.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/organization/appointment-changes.ts";
import { findPatientWarnings } from "#/organization/appointment-placement.ts";
import { bookAppointment } from "#/organization/appointments.ts";
import { bookingSlotFor } from "#/organization/booking-times.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { notifyBooking, notifyCancellation } from "#/organization/notifications.ts";
import {
  cutoffHoursOf,
  freeTimesFor,
  movePatientAppointment,
  slotFor,
} from "#/organization/moves.ts";
import type { Slot } from "#/organization/moves.ts";
import { answeredMeanwhile } from "#/organization/turn-retries.ts";
import { isHeld, lastIncomingAt, patientsReachedAt } from "#/organization/whatsapp-messages.ts";
import { conversation, proposal } from "#/organization/whatsapp-schema.ts";

// Proposals (docs/domain/assistant.md § Proposals, ADR-0006 § The model
// interprets): the patient assistant's only way to change or book an
// appointment. A proposal holds the change in full; accepting the
// conversation's latest, before it expires and while the appointment is as
// stated, runs the appointment's own change functions, or the app's own
// booking, so their rules hold and the change can still fail.

/**
 * The assistant as the change functions see it: it acts for every
 * practitioner, as reception does, on the appointments of the number's
 * patients only, which the turn's tools already narrowed.
 */
export const assistantActing: Acting = { userId: assistantUserId, roles: ["receptionist"] };

/** The change as the patient reads it: the appointment, the practitioner, the date and the time, never the office. */
function stated(kind: ProposalKind, upcoming: Upcoming) {
  return {
    kind,
    medicalService: upcoming.medicalService,
    practitioner: upcoming.practitioner,
    ...whenOf(upcoming),
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
  return { newDate: slot.date, newTime: slot.time };
}

/** A booking as the patient reads it: the medical service, the practitioner, the date and the time, never the room. */
function statedBooking(slot: {
  medicalService: string;
  practitioner: string;
  date: string;
  time: string;
}) {
  const { medicalService, practitioner, date, time } = slot;
  return { kind: "book", medicalService, practitioner, date, time };
}

type Stored = NonNullable<ReturnType<typeof latestProposal>>;

/**
 * Books the proposal's appointment while its time is still one
 * find_booking_times offers, in the room and as the patient was told it: the
 * app's booking then checks it again in the same transaction. The patient was
 * told of their other appointments that day before the proposal, so they do
 * not hold it.
 */
function book(database: Database, latest: Stored) {
  const { patientId, medicalServiceId, startsAt, endsAt } = latest;
  if (patientId === null || medicalServiceId === null || startsAt === null || endsAt === null) {
    throw new Error("A booking proposal states its patient, medical service and span");
  }
  const found = bookingSlotFor(database, `${medicalServiceId}@${new Date(startsAt).toISOString()}`);
  if (!found.ok || found.slot.roomId !== latest.roomId || +found.slot.end !== endsAt) {
    return { ok: false, reason: "timeTaken" } as const;
  }
  const { slot } = found;
  if (JSON.stringify(statedBooking(slot)) !== JSON.stringify(latest.statement)) {
    return { ok: false, reason: "changed" } as const;
  }
  const booked = bookAppointment(
    database,
    assistantActing,
    {
      patientId,
      practitionerId: slot.practitionerId,
      medicalServiceId,
      start: slot.start,
      durationMinutes: (endsAt - startsAt) / 60_000,
      confirmWarnings: true,
    },
    { inConversation: true },
  );
  if (!booked.ok) {
    return {
      ok: false,
      reason: booked.reason === "notFree" ? "timeTaken" : booked.reason,
    } as const;
  }
  return { ok: true, appointmentId: booked.appointment.id } as const;
}

/** Makes the proposal's change through the appointment's own function, or books it; the sandbox replays its accepted ones with it. */
export function applyChange(database: Database, latest: Stored) {
  if (latest.kind === "book") {
    return book(database, latest);
  }
  const appointmentId = present(latest.appointmentId, "A change proposal names its appointment");
  if (latest.kind === "move") {
    const { newDate, newTime } = latest.statement;
    return movePatientAppointment(database, assistantActing, {
      appointmentId,
      stated: {
        slotId: new Date(latest.startsAt ?? 0).toISOString(),
        date: newDate,
        time: newTime,
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
 * move a rule refused, which underthing hands off, why, and the changes it
 * made, which that handoff's notification states.
 */
interface ProposalTurn {
  conversationId: string;
  /** The patient's messages the turn reads as new, and the patients the number stands for. */
  read: { unjudged: { id: string }[]; patients: { id: string }[] };
  appointments: Upcoming[];
  recorded: {
    ruleRefused: string | null;
    refusal: HandoffDetail["refused"];
    applied: HandoffDetail["applied"];
    proposed: boolean;
  };
}

const moveRefusals: string[] = ["pastCutoff", "moveUsed"] satisfies MoveRefusal[];

/** Returns a refusal, noting a move a rule refused, and why, for the turn's handoff. */
function refused(database: Database, turn: ProposalTurn, appointmentId: string, reason: string) {
  const upcoming = turn.appointments.find((one) => one.id === appointmentId);
  if (moveRefusals.includes(reason) && upcoming) {
    turn.recorded.ruleRefused = appointmentId;
    turn.recorded.refusal = {
      why: reason as MoveRefusal,
      cutoffHours: cutoffHoursOf(database, appointmentId),
      ...whenOf(upcoming),
    };
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
    return refused(database, turn, appointmentId, found.reason);
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
      return refused(database, turn, appointmentId, found.reason);
    }
    move = found.slot;
  }
  const statement = { ...stated(kind, upcoming), ...(move && statedMove(move)) };
  storeProposal(database, turn, {
    appointmentId,
    kind,
    statement,
    startsAt: move && Date.parse(move.slotId),
  });
  return { ok: true, proposal: statement };
}

/** Stores a proposal as the conversation's latest, which the turn's reply states. */
function storeProposal(
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

/**
 * Stores the booking the model proposed, for one of the number's patients at
 * a time find_booking_times offers, with that patient's other appointments
 * that day, which the patient is told of before they say yes.
 */
function proposeBooking(database: Database, turn: ProposalTurn, args: unknown) {
  const parsed = assistantToolSchemas.propose_booking.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { patientId, slotId } = parsed.data;
  if (!turn.read.patients.some((one) => one.id === patientId)) {
    return { ok: false, reason: "notFound" };
  }
  const found = bookingSlotFor(database, slotId);
  if (!found.ok) {
    return found;
  }
  const { slot } = found;
  const statement = statedBooking(slot);
  storeProposal(database, turn, {
    kind: "book",
    statement,
    patientId,
    medicalServiceId: slot.medicalServiceId,
    practitionerId: slot.practitionerId,
    roomId: slot.roomId,
    startsAt: +slot.start,
    endsAt: +slot.end,
  });
  const alreadyBooked = findPatientWarnings(database, patientId, slot, undefined).map((one) => ({
    date: formatDay(one.start, practiceTimeZone),
    time: formatTime(one.start, practiceTimeZone),
    practitioner: one.practitionerName,
    overlaps: one.kind === "overlap",
  }));
  return { ok: true, proposal: statement, alreadyBooked };
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
  return upcomingAppointments(database, phoneOf(database, conversationId), Date.now()).find(
    (one) => one.id === appointmentId,
  );
}

function phoneOf(database: Database, conversationId: string) {
  return present(
    database
      .select({ phone: conversation.phone })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get(),
    "A proposal's conversation is stored",
  ).phone;
}

/** Accepts the conversation's latest proposal in one transaction: books it, or makes its change. */
function acceptLatest(database: Database, turn: ProposalTurn) {
  return database.transaction(() => {
    const latest = latestProposal(database, turn.conversationId);
    const now = Date.now();
    const refusal = refusalOf(latest, now);
    if (refusal || !latest) {
      return { ok: false, reason: refusal };
    }
    return latest.kind === "book"
      ? acceptBooking(database, turn, latest, now)
      : acceptChange(database, turn, latest, now);
  });
}

/**
 * Books the accepted proposal while the conversation's number still stands
 * for its patient, tells its practitioner, and adds the appointment to the
 * turn's view.
 */
function acceptBooking(database: Database, turn: ProposalTurn, latest: Stored, now: number) {
  const phone = phoneOf(database, turn.conversationId);
  const reached = patientsReachedAt(database, phone)
    .all()
    .some((one) => one.id === latest.patientId);
  if (!reached) {
    return { ok: false, reason: "notFound" };
  }
  const booked = book(database, latest);
  if (!booked.ok) {
    return booked;
  }
  database.update(proposal).set({ acceptedAt: now }).where(eq(proposal.id, latest.id)).run();
  const { date, time } = latest.statement;
  if (date === undefined || time === undefined) {
    throw new Error("A proposal states the appointment's date and time");
  }
  turn.recorded.applied.push({ kind: "book", date, time });
  notifyBooking(database, booked.appointmentId);
  turn.appointments.push(
    present(
      upcomingAppointments(database, phone, now).find((one) => one.id === booked.appointmentId),
      "An appointment the patient just booked is upcoming for the conversation",
    ),
  );
  sortAsUpcoming(turn.appointments);
  return { ok: true, applied: latest.statement };
}

/** As upcomingAppointments orders them, so the reply's check compares like with like. */
function sortAsUpcoming(appointments: Upcoming[]) {
  appointments.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

/**
 * Makes the accepted proposal's change while the appointment is as the
 * patient was told, marks it accepted, and updates the turn's view by that
 * change alone.
 */
function acceptChange(database: Database, turn: ProposalTurn, latest: Stored, now: number) {
  const appointmentId = present(latest.appointmentId, "A change proposal names its appointment");
  const { appointments } = turn;
  const index = appointments.findIndex((one) => one.id === appointmentId);
  const viewed = appointments[index];
  const current = appointmentNow(database, turn.conversationId, appointmentId);
  if (!viewed || !current) {
    return { ok: false, reason: "notFound" };
  }
  // Moved, or its practitioner changed, since it was proposed.
  const asNow = Object.entries(stated(latest.kind, current));
  if (asNow.some(([key, value]) => latest.statement[key] !== value)) {
    return { ok: false, reason: "changed" };
  }
  const changed = applyChange(database, latest);
  if (!changed.ok) {
    return refused(database, turn, current.id, changed.reason);
  }
  database.update(proposal).set({ acceptedAt: now }).where(eq(proposal.id, latest.id)).run();
  const { date, time, newDate, newTime } = latest.statement;
  if (date === undefined || time === undefined) {
    throw new Error("A proposal states the appointment's date and time");
  }
  turn.recorded.applied.push({ kind: latest.kind, date, time, newDate, newTime });
  // Only the turn's own change: anything else changed meanwhile still holds its reply.
  if (latest.kind === "confirm") {
    appointments[index] = { ...viewed, status: "confirmed" };
  } else if (latest.kind === "move") {
    appointments[index] = present(
      appointmentNow(database, turn.conversationId, current.id),
      "An appointment the patient just moved is still upcoming for the conversation",
    );
    sortAsUpcoming(appointments);
  } else {
    appointments.splice(index, 1);
    notifyCancellation(database, current.id);
  }
  return { ok: true, applied: latest.statement };
}

/**
 * The turn's proposal tools. `appointments` is the turn's view of the
 * number's upcoming appointments, which they act on only, and which an
 * accepted change updates in place, so the turn's reply is checked against
 * the state its own change left. Nothing is proposed or accepted while a
 * person holds the conversation; an open handoff does not stop them, since a
 * person has only the topic it is about.
 */
export function proposalTools(database: Database, turn: ProposalTurn): AssistantTool[] {
  // A person answers while a member holds the conversation, or answered the
  // turn's words since it read them.
  const unlessHeld = (run: () => ToolResult) =>
    isHeld(database, turn.conversationId) ||
    answeredMeanwhile(
      database,
      turn.read.unjudged.map((message) => message.id),
    )
      ? { ok: false, reason: "held" }
      : run();
  return [
    { name: "find_free_times", run: (args) => findFreeTimes(database, turn, args) },
    {
      name: "propose_change",
      run: (args) => unlessHeld(() => proposeChange(database, turn, args)),
    },
    {
      name: "propose_booking",
      run: (args) => unlessHeld(() => proposeBooking(database, turn, args)),
    },
    { name: "accept_proposal", run: () => unlessHeld(() => acceptLatest(database, turn)) },
  ];
}
