import type * as z from "zod";

import type { assistantToolSchemas } from "#/lib/assistant.ts";
import type { HandoffDetail } from "#/lib/handoffs.ts";

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
  /** Why, as the handoff's notification says it. */
  refusal: HandoffDetail["refused"];
  /** The changes the turn's accepted proposals made, which that notification names too. */
  applied: HandoffDetail["applied"];
  /** The patients whose messages go to the number as the turn settles: a contact may change while the model runs. */
  reachedNow: string[];
  /** The turn's messages are voice notes nobody could understand (`assistant.ts`). */
  unintelligible?: boolean;
  /** The turn's messages hold a photo, a video or a file, which the model never reads. */
  media?: boolean;
}

const modelReasons = {
  patient_asked: "patientAsked",
  organization_cancelled: "organizationCancelled",
  rule_refused: "ruleRefused",
  clinical: "clinical",
  emergency: "emergency",
} as const satisfies Record<HandOffCall["reason"], HandoffWanted["reason"]>;

/**
 * A follow-up's answer: only a plainly good one, or an opt-out that needs
 * no practitioner, is the assistant's; any other, a photo included, is the
 * practitioner's. So is an opt-out from a number that reaches no patient
 * now, its contact moved while the model ran: there is no consent to turn off.
 */
function followUpHandoff(turn: TurnToSort, appointmentId: string): HandoffWanted | null {
  const { judgement } = turn;
  const plainlyGood = judgement.followUpAnswer === "plainlyGood" && !judgement.needsPractitioner;
  const optOutOnly = judgement.optOut && !judgement.needsPractitioner;
  const nobodyToTurnOff = judgement.optOut && turn.reachedNow.length === 0;
  const answeredByAssistant = (plainlyGood || optOutOnly) && !turn.media;
  if (answeredByAssistant && !nobodyToTurnOff && !judgement.emergency && !turn.handOff) {
    return null;
  }
  const reason = judgement.emergency ? "emergency" : "followUpAnswer";
  return { reason, forPractitioner: true, appointmentId };
}

/** The model's hand_off, to the practitioner when its reason or the judgement says so. */
function modelHandoff(turn: TurnToSort, handOff: HandOffCall): HandoffWanted {
  const { judgement, answered } = turn;
  // Only an appointment the turn could speak of: the model's id is checked, not trusted.
  const known = [...turn.appointments.map((one) => one.id), answered?.appointmentId];
  const named = known.find((id) => id !== undefined && id === handOff.appointmentId);
  const practitionerReason = handOff.reason === "clinical" || handOff.reason === "emergency";
  return {
    reason: modelReasons[handOff.reason],
    forPractitioner: judgement.needsPractitioner || judgement.emergency || practitionerReason,
    appointmentId: named ?? null,
  };
}

/**
 * What underthing hands off without the model asking: what needs the
 * practitioner, a move a rule refused, a photo or a file, a second
 * misunderstanding (a voice note nobody could understand counts as one),
 * nothing booked. An opt-out from a number of patients is answered, not
 * handed off, unless it needs the practitioner too.
 */
function judgedHandoff(turn: TurnToSort): HandoffWanted | null {
  const { judgement } = turn;
  if (judgement.needsPractitioner || judgement.emergency) {
    const reason = judgement.emergency ? "emergency" : "clinical";
    return { reason, forPractitioner: true, appointmentId: null };
  }
  if (turn.ruleRefused) {
    return { reason: "ruleRefused", forPractitioner: false, appointmentId: turn.ruleRefused };
  }
  if (turn.media) {
    return { reason: "media", forPractitioner: false, appointmentId: null };
  }
  if (judgement.optOut && turn.reachedNow.length > 0) {
    return null;
  }
  const reason = unansweredReason(turn);
  return reason ? { reason, forPractitioner: false, appointmentId: null } : null;
}

/**
 * Why a turn that needs no practitioner and was not refused is handed off, if it is: a
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
  if (!wanted) {
    return null;
  }
  const detail = turn.refusal || turn.applied.length > 0 ? { refused: turn.refusal, applied: turn.applied } : null;
  // A handoff about nothing in particular, right after a message about an
  // appointment, concerns that appointment.
  return {
    ...wanted,
    appointmentId: wanted.appointmentId ?? answered?.appointmentId ?? null,
    detail,
  };
}
