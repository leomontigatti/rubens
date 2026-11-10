import type * as z from "zod";

import type { assistantToolSchemas } from "#/lib/assistant.ts";

import type { answeredMessage, HandoffWanted } from "#/organization/handoffs.ts";

// Which handoff a judged turn of the patient assistant calls for
// (docs/domain/assistant.md § Handoff): the follow-up's answer, the model's
// hand_off, and what underthing hands off itself. The assistant's turn
// (`assistant.ts`) settles it; opening one is `handoffs.ts`'s.

export type Judgement = z.output<typeof assistantToolSchemas.judge_messages.inputSchema>;

export type HandOffCall = z.output<typeof assistantToolSchemas.hand_off.inputSchema>;

/** What of a judged turn its handoff is chosen from. */
export interface TurnToSort {
  read: { misunderstandings: number; patients: unknown[] };
  appointments: { id: string }[];
  /** The follow-up or cancellation the patient's new messages answer, if any. */
  answered: ReturnType<typeof answeredMessage>;
  judgement: Judgement;
  handOff: HandOffCall | null;
  /** The appointment a rule kept the patient from moving (past the cutoff, the one move used). */
  ruleRefused: string | null;
  /** The patients whose messages go to the number as the turn settles: a contact may change while the model runs. */
  reachedNow: string[];
  /** The turn's messages are voice notes nobody could understand (`assistant.ts`). */
  unintelligible?: boolean;
}

const modelReasons = {
  patient_asked: "patientAsked",
  organization_cancelled: "organizationCancelled",
  rule_refused: "ruleRefused",
  clinical: "clinical",
  emergency: "emergency",
} as const satisfies Record<HandOffCall["reason"], HandoffWanted["reason"]>;

/**
 * A follow-up's answer: only a plainly good one, or an opt-out that is not
 * clinical, is the assistant's; any other is the practitioner's, as clinical.
 * So is an opt-out from a number that reaches no patient now, its contact
 * moved while the model ran: there is no consent to turn off.
 */
function followUpHandoff(turn: TurnToSort, appointmentId: string): HandoffWanted | null {
  const { judgement } = turn;
  // A photo or a file beside the answer makes it clinical (`assistant.ts`).
  const plainlyGood = judgement.followUpAnswer === "plainlyGood" && !judgement.clinical;
  const optOutOnly = judgement.optOut && !judgement.clinical;
  const nobodyToTurnOff = judgement.optOut && turn.reachedNow.length === 0;
  if ((plainlyGood || optOutOnly) && !nobodyToTurnOff && !judgement.emergency && !turn.handOff) {
    return null;
  }
  const reason = judgement.emergency ? "emergency" : "followUpAnswer";
  return { reason, clinical: true, appointmentId };
}

/** The model's hand_off, clinical when the call or the judgement says so. */
function modelHandoff(turn: TurnToSort, handOff: HandOffCall): HandoffWanted {
  const { judgement, answered } = turn;
  // Only an appointment the turn could speak of: the model's id is checked, not trusted.
  const known = [...turn.appointments.map((one) => one.id), answered?.appointmentId];
  const named = known.find((id) => id !== undefined && id === handOff.appointmentId);
  const clinicalReason = handOff.reason === "clinical" || handOff.reason === "emergency";
  return {
    reason: modelReasons[handOff.reason],
    clinical: judgement.clinical || judgement.emergency || handOff.clinical || clinicalReason,
    appointmentId: named ?? null,
  };
}

/**
 * What underthing hands off without the model asking: a clinical judgement,
 * a move a rule refused, a second misunderstanding (a voice note nobody could
 * understand counts as one), nothing booked. An
 * opt-out from a number of patients is answered, not handed off, unless it is
 * clinical too.
 */
function judgedHandoff(turn: TurnToSort): HandoffWanted | null {
  const { judgement } = turn;
  if (judgement.clinical || judgement.emergency) {
    const reason = judgement.emergency ? "emergency" : "clinical";
    return { reason, clinical: true, appointmentId: null };
  }
  if (turn.ruleRefused) {
    return { reason: "ruleRefused", clinical: false, appointmentId: turn.ruleRefused };
  }
  if (judgement.optOut && turn.reachedNow.length > 0) {
    return null;
  }
  const reason = unansweredReason(turn);
  return reason ? { reason, clinical: false, appointmentId: null } : null;
}

/**
 * Why a turn that is neither clinical nor refused is handed off, if it is: a
 * second misunderstanding, a number of no patient, nothing booked. An opt-out
 * reaching here comes from a number that reaches nobody now, its contact moved
 * while the model ran, so there is no consent to turn off.
 */
function unansweredReason(turn: TurnToSort): HandoffWanted["reason"] | null {
  const { judgement } = turn;
  if (!judgement.understood && turn.read.misunderstandings >= 1) {
    return turn.unintelligible ? "voiceUnintelligible" : "misunderstoodTwice";
  }
  if (turn.read.patients.length === 0 || judgement.optOut) {
    return "unknownNumber";
  }
  return turn.appointments.length === 0 ? "noUpcomingAppointment" : null;
}

/**
 * The handoff the turn calls for, if any (assistant.md § Handoff): a
 * follow-up's answer is sorted first, then the model's hand_off, then what
 * underthing hands off itself.
 */
export function handoffWanted(turn: TurnToSort): HandoffWanted | null {
  const { answered } = turn;
  if (answered?.kind === "followUp" && answered.firstReply) {
    return followUpHandoff(turn, answered.appointmentId);
  }
  const wanted = turn.handOff ? modelHandoff(turn, turn.handOff) : judgedHandoff(turn);
  // A handoff about nothing in particular, right after a message about an
  // appointment, concerns that appointment.
  return (
    wanted && { ...wanted, appointmentId: wanted.appointmentId ?? answered?.appointmentId ?? null }
  );
}
