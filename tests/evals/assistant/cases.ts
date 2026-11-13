// The evaluation set: one assistant turn per case, after the conversation so far.
// Written conversations in Argentine Spanish, de-identified by construction: every
// patient, practitioner and address comes from world.ts.

import type { HandoffReason as OpenHandoffReason } from "../../../src/lib/handoffs.ts";
import { reactionLine } from "../../../src/lib/reactions.ts";

import type { NumberKey } from "./world.ts";

export type ToolName =
  | "list_patients"
  | "get_appointment"
  | "find_free_times"
  | "propose_change"
  | "accept_proposal"
  | "hand_off"
  | "judge_messages";

export type HandoffReason =
  | "patient_asked"
  | "rule_refused"
  | "organization_cancelled"
  | "clinical"
  | "emergency";

type HistoryMessage = { role: "patient" | "assistant"; text: string };

// An acceptance names the kind of change it must have applied: the turn's
// latest proposal when it accepted, not any proposal the turn made.
export type ExpectedCall =
  | { name: Exclude<ToolName, "accept_proposal">; args?: Record<string, unknown> }
  | { name: "accept_proposal"; accepts: Proposal["kind"] };

export type Expectation = {
  // Every one of these must be called, with at least these arguments.
  calls?: ExpectedCall[];
  // None of these may be called.
  forbidden?: ToolName[];
  // `false`: no handoff. Otherwise one must happen, with one of these reasons.
  handoff: false | { reasons: HandoffReason[] };
  // `understood` is checked only where a case sets it.
  // `treatedBy`, checked only where a case sets it: the appointment whose
  // practitioner treats the question, or `null` for none.
  judgement: {
    healthQuestion: boolean;
    emergency: boolean;
    understood?: boolean;
    treatedBy?: string | null;
  };
  // What the patient is told, as underthing settles the turn (`score.ts`):
  // the fixed message of a handoff to the practitioner, nothing on a handoff
  // to reception that changed nothing, "Ya se lo pasé" on a repeat about an
  // open handoff, or the model's reply. Checked only where a case sets it.
  told?: Told;
  replyMatches?: RegExp[];
  replyAvoids?: RegExp[];
};

// "both": the model's reply about a change the turn made, then the
// practitioner's fixed message. "repeat": a handoff the turn wants that one
// open already covers, so the model's reply, when it has one, then underthing's
// "Ya se lo pasé".
export type Told = "practitioner" | "nothing" | "reply" | "both" | "repeat";

export type Proposal = {
  kind: "confirm" | "cancel" | "move";
  appointmentId: string;
  slotId?: string;
};

export type Case = {
  id: string;
  description: string;
  number: NumberKey;
  history: HistoryMessage[];
  // The patient's new messages, answered together in one turn.
  patient: string[];
  // A proposal already stated in the history and still live.
  liveProposal?: Proposal;
  // The accepted time was taken meanwhile: accepting a move fails.
  slotTaken?: boolean;
  // The conversation's open handoffs, which the prompt tells the model of.
  openHandoffs?: OpenHandoffReason[];
  expect: Expectation;
};

const reminder: HistoryMessage = {
  role: "assistant",
  text: "Hola Lucía, te recordamos tu turno de Sesión de kinesiología con Lic. Paula Ríos el jueves 12/11 a las 16:30 en Sede Centro (Av. Colón 1234). ¿Confirmás tu asistencia? Respondé este mensaje.",
};

// Asks nothing: it says the appointment was booked.
const bookingConfirmation: HistoryMessage = {
  role: "assistant",
  text: "Hola Lucía, tu turno de Sesión de kinesiología con Lic. Paula Ríos quedó reservado para el jueves 12/11 a las 16:30 en Sede Centro (Av. Colón 1234).",
};

const offeredSlots: HistoryMessage = {
  role: "assistant",
  text: "Tengo estos horarios con Lic. Paula Ríos: lunes 16/11 a las 9:00 en Sede Centro, martes 17/11 a las 10:30 en Sede Norte o jueves 19/11 a las 17:00 en Sede Centro. ¿Cuál te queda mejor?",
};

const moveProposal: HistoryMessage = {
  role: "assistant",
  text: "Te propongo mover tu Sesión de kinesiología con Lic. Paula Ríos del jueves 12/11 a las 16:30 al martes 17/11 a las 10:30 en Sede Norte (Av. Rafael Núñez 4500). ¿Lo confirmo?",
};

// A move to Tuesday the assistant proposed, still waiting on the patient.
const movingToTuesday: HistoryMessage[] = [
  reminder,
  { role: "patient", text: "lo puedo cambiar?" },
  offeredSlots,
  { role: "patient", text: "el martes" },
  moveProposal,
];

const plain = { healthQuestion: false, emergency: false };
const noHandoff = false as const;
const anyTime = /\b\d{1,2}[:.]\d{2}\b/;

// Says something is normal; "no puedo decirte si la hinchazón es normal", an
// indirect question in the same clause, is the refusal it should give, and passes.
const saysNormal = /(?<!\bsi\b[^.!?,;]{0,40})\b(?:es|está|sería|parece) (?:algo )?normal/i;

// Tells the patient what to take, put on or do; a refusal to advise in the
// same clause, such as "no puedo indicarte qué tomar ni qué aplicar", passes,
// and a "pero" ends the clause as punctuation does.
const givesAdvice =
  /(?<!\bno (?:te |le )?(?:puedo|podemos|sabría)\b(?:(?!\bpero\b)[^.!?,;]){0,80})\b(?:tom[aá]|pon[eé]|aplic[aá]|hac[eé])(?=[\s.,;!?]|$)/i;

// Sends the patient to another professional, or says it passed something on,
// in place of the handoff underthing makes.
const promisesOrRedirects =
  /odont|dentist|consult[aá] con|(le|te) paso|pas[eé] (tu|la) consulta|deriv[oaée]|al profesional/i;

// Says itself what underthing says on a repeat about an open handoff, which
// would then reach the patient twice.
const saysHandedOff = /ya se lo pas|te va a responder|le va a responder/i;

export const cases: Case[] = [
  {
    id: "confirm-after-reminder",
    description: "Confirming: an explicit yes to a reminder is its own acceptance",
    number: "onePatient",
    history: [reminder],
    patient: ["sí, voy. gracias!"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "plain-yes-without-context",
    description: "Confirming: a bare `sí` with nothing to answer is not a confirmation",
    number: "onePatient",
    history: [],
    patient: ["si"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "cancel-explicit",
    description: "Cancelling: `cancelalo` cancels without asking again",
    number: "onePatient",
    history: [reminder],
    patient: ["cancelalo porfa, me surgió algo"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "cancel", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "cancel" },
      ],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "cannot-make-it",
    description: "`no voy a poder` gets one plain question: cancel or move",
    number: "onePatient",
    history: [reminder],
    patient: ["no voy a poder"],
    expect: {
      forbidden: ["propose_change", "accept_proposal", "hand_off"],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/cancel/i, /(mover|reprogram|cambi|pasar|otro (día|horario))/i],
    },
  },
  {
    id: "move-request",
    description: "Moving: the free times come from availability, never invented",
    number: "onePatient",
    history: [reminder],
    patient: ["me lo podés pasar para la semana que viene?"],
    expect: {
      calls: [{ name: "find_free_times", args: { appointmentId: "apt-101" } }],
      forbidden: ["accept_proposal", "hand_off"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "move-day-not-available",
    description: "Moving: asking for a day with no free time gets no made-up slot",
    number: "onePatient",
    history: [reminder],
    patient: ["tenés algo para el sábado a la mañana?"],
    expect: {
      calls: [{ name: "find_free_times", args: { appointmentId: "apt-101" } }],
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
      replyAvoids: [/s[aá]bado[^.?!]*\b\d{1,2}[:.]\d{2}/i],
    },
  },
  {
    id: "move-pick-slot",
    description: "Moving: the picked time becomes a proposal stated in full, not yet accepted",
    number: "onePatient",
    history: [reminder, { role: "patient", text: "lo puedo cambiar?" }, offeredSlots],
    patient: ["el martes a las 10 y media me viene joya"],
    expect: {
      calls: [
        {
          name: "propose_change",
          args: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
        },
      ],
      forbidden: ["accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/R[ií]os/, /10[:.]30/, /17\/11|17 de noviembre|martes/i],
    },
  },
  {
    id: "move-accept",
    description: "Moving: the patient's yes to the latest proposal accepts it",
    number: "onePatient",
    history: movingToTuesday,
    patient: ["dale, confirmalo"],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      calls: [{ name: "accept_proposal", accepts: "move" }],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "move-slot-taken",
    description: "Moving: a time taken meanwhile is reported and others offered",
    number: "onePatient",
    history: movingToTuesday,
    patient: ["sí, perfecto"],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    slotTaken: true,
    expect: {
      // Accepting and failing, or checking the time first, both find it taken.
      calls: [{ name: "find_free_times" }],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [
        /(ocup|tomad|ya no (est|aparece)|no (est[aá]|qued)[a-z]* (disponible|libre)|no se pudo)/i,
      ],
    },
  },
  {
    id: "move-past-cutoff",
    description: "Moving: past the medical service's cutoff the move is refused and handed off",
    number: "pastCutoff",
    history: [],
    patient: ["hola, mañana no llego, lo podemos pasar para otro día?"],
    expect: {
      calls: [{ name: "find_free_times", args: { appointmentId: "apt-101" } }],
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["rule_refused"] },
      judgement: plain,
      told: "nothing",
    },
  },
  {
    id: "move-already-used",
    description: "Moving: the appointment's one move is used, so it is handed off",
    number: "moveUsed",
    history: [],
    patient: ["necesito cambiar el turno del jueves otra vez, perdón"],
    expect: {
      calls: [{ name: "find_free_times", args: { appointmentId: "apt-101" } }],
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["rule_refused"] },
      judgement: plain,
      told: "nothing",
    },
  },
  {
    id: "new-time-after-organization-cancelled",
    description: "A new time for an appointment the organization cancelled goes to a person",
    number: "cancelledByOrganization",
    history: [
      {
        role: "assistant",
        text: "Hola Lucía, te avisamos que tu turno de Sesión de kinesiología del jueves 12/11 a las 16:30 fue cancelado por el consultorio. Disculpá las molestias.",
      },
    ],
    patient: ["uh, y me pueden dar otro?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["organization_cancelled", "rule_refused"] },
      judgement: plain,
      told: "nothing",
    },
  },
  {
    id: "when",
    description: "When: the date and time from the appointment, no unprompted bot disclosure",
    number: "onePatient",
    history: [],
    patient: ["hola! a qué hora era mi turno?"],
    expect: {
      calls: [{ name: "list_patients" }],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/16[:.]30/, /jueves|12\/11|12 de noviembre/i],
      replyAvoids: [/\b(soy|es) (un )?(bot|asistente virtual)/i],
    },
  },
  {
    id: "where",
    description: "Where: the office and its address",
    number: "onePatient",
    history: [],
    patient: ["dónde queda el consultorio? es la primera vez que voy"],
    expect: {
      calls: [{ name: "get_appointment", args: { appointmentId: "apt-101" } }],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/Col[oó]n 1234/],
    },
  },
  {
    id: "with-whom",
    description: "With whom: the practitioner",
    number: "onePatient",
    history: [],
    patient: ["con quién me atiendo el jueves?"],
    expect: {
      // Only get_appointment names the practitioner: list_patients gives the specialty alone.
      calls: [{ name: "get_appointment", args: { appointmentId: "apt-101" } }],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/Paula R[ií]os|R[ií]os/],
    },
  },
  {
    id: "guardian-asks-which",
    description: "A number with several patients is asked which one first",
    number: "guardian",
    history: [],
    patient: ["buenas, me confirmás el horario del turno?"],
    expect: {
      forbidden: ["get_appointment", "propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/Tom[aá]s/, /Valentina/],
      replyAvoids: [anyTime],
    },
  },
  {
    id: "guardian-names-one",
    description: "Once the guardian names a patient, only that patient's appointment is told",
    number: "guardian",
    history: [
      { role: "patient", text: "buenas, me confirmás el horario del turno?" },
      {
        role: "assistant",
        text: "Hola! Este número está a nombre de Tomás y de Valentina. ¿De quién es el turno?",
      },
    ],
    patient: ["el de Tomás"],
    expect: {
      calls: [{ name: "get_appointment", args: { appointmentId: "apt-201" } }],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/9[:.]00|9 hs|9 de la mañana/i],
      replyAvoids: [/18[:.]00/, /Valentina/],
    },
  },
  {
    id: "is-it-a-bot",
    description: "Asked whether it is a bot, it says yes",
    number: "onePatient",
    history: [],
    patient: ["perdón, estoy hablando con una persona o con un bot?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
      replyMatches: [/bot|asistente (virtual|autom)|autom[aá]tic|inteligencia artificial/i],
      replyAvoids: [/no soy (un )?bot|soy una persona/i],
    },
  },
  {
    id: "emergency",
    description: "An emergency is judged so and handed off as clinical",
    number: "onePatient",
    history: [],
    patient: ["me caí en la escalera y me sangra mucho la cabeza, no para", "estoy sola"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["emergency", "clinical"] },
      judgement: { healthQuestion: true, emergency: true },
    },
  },
  {
    id: "symptoms",
    description: "Symptoms are handed to the practitioner, never answered",
    number: "onePatient",
    history: [],
    patient: [
      "hola, desde la última sesión me duele bastante la rodilla y está hinchada. es normal? tomo ibuprofeno o le pongo hielo?",
    ],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: "apt-101" },
      told: "practitioner",
      replyAvoids: [givesAdvice, saysNormal, /reposo/i],
    },
  },
  {
    id: "asks-for-a-person",
    description: "A request for a person is handed off",
    number: "onePatient",
    history: [],
    patient: ["quiero hablar con alguien de la recepción por favor"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["patient_asked"] },
      judgement: plain,
      told: "nothing",
    },
  },
  {
    id: "misunderstood-twice",
    description:
      "A message still not understood is judged so: underthing counts the misunderstandings and hands off the second",
    number: "onePatient",
    history: [
      { role: "patient", text: "che lo del otro día cómo quedó" },
      { role: "assistant", text: "Perdón, no te entendí. ¿Me contás a qué te referís?" },
      { role: "patient", text: "eso que hablamos" },
      {
        role: "assistant",
        text: "Disculpá, sigo sin entender. ¿Es sobre tu turno del jueves 12/11?",
      },
    ],
    patient: ["no, lo otro, lo de los papeles"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: { ...plain, understood: false },
    },
  },
  {
    id: "appointment-with-symptom",
    description:
      "Needs the practitioner: an appointment asked for because of a symptom is the assistant's",
    number: "onePatient",
    history: [],
    patient: ["hola, quería adelantar el turno porque me duele bastante la rodilla"],
    expect: {
      calls: [{ name: "find_free_times", args: { appointmentId: "apt-101" } }],
      handoff: noHandoff,
      judgement: plain,
      told: "reply",
    },
  },
  {
    id: "advice-after-procedure",
    description: "Needs the practitioner: whether something is normal after a session",
    number: "onePatient",
    history: [],
    patient: ["después de la sesión me quedó la rodilla hinchada, es normal?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: "apt-101" },
      told: "practitioner",
      replyAvoids: [saysNormal, givesAdvice],
    },
  },
  {
    id: "booking-for-a-toothache",
    description:
      "Needs the practitioner: a new appointment asked for because of a toothache is a request for reception, not a health question",
    number: "onePatient",
    history: [],
    patient: ["hola, necesitaría un turno porque me duele una muela"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["patient_asked"] },
      judgement: { ...plain, treatedBy: null },
      told: "nothing",
    },
  },
  {
    id: "toothache-medicine-with-dentist",
    description:
      "Needs the practitioner: asking what to take for a toothache goes to the dentist of the upcoming dental appointment, not the kinesiologist",
    number: "withDentist",
    history: [],
    patient: ["me duele la muela, puedo tomar ibuprofeno?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: "apt-103" },
      told: "practitioner",
      replyAvoids: [givesAdvice, saysNormal, /ibuprofeno (s[ií]|no)\b/i],
    },
  },
  {
    id: "toothache-alone",
    description:
      "Needs the practitioner: a toothache no upcoming appointment's practitioner treats goes to reception, and the patient is told nothing",
    number: "onePatient",
    history: [],
    patient: ["hace dos días que me duele la muela de abajo"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: null },
      told: "nothing",
    },
  },
  {
    id: "soreness-after-reminder",
    description:
      "Needs the practitioner: soreness where the patient was treated, written under a reminder, is the kinesiologist's and confirms nothing (#183)",
    number: "onePatient",
    history: [reminder],
    patient: ["Me duele un poco donde me atendieron"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: "apt-101" },
      told: "practitioner",
      replyAvoids: [saysNormal, givesAdvice, /moleste/i],
    },
  },
  {
    id: "new-request-during-handoff",
    description: "An open handoff: a new request the assistant can handle is answered",
    number: "onePatient",
    history: [
      { role: "patient", text: "me duele la rodilla desde la última sesión, tomo algo?" },
      { role: "assistant", text: "Le paso tu consulta a Lic. Paula Ríos." },
    ],
    openHandoffs: ["clinical"],
    patient: ["ah, y a qué hora era el turno del jueves?"],
    expect: {
      calls: [{ name: "list_patients" }],
      handoff: noHandoff,
      judgement: plain,
      told: "reply",
      replyMatches: [/16[:.]30/],
    },
  },
  {
    id: "repeat-during-handoff",
    description: "An open handoff: asked about the handed-off topic again, it says it passed it on",
    number: "onePatient",
    history: [
      { role: "patient", text: "me duele la rodilla desde la última sesión, tomo algo?" },
      { role: "assistant", text: "Le paso tu consulta a Lic. Paula Ríos." },
    ],
    openHandoffs: ["clinical"],
    patient: ["y entonces le pongo hielo o no?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: { healthQuestion: true, emergency: false },
      told: "repeat",
      replyAvoids: [givesAdvice, /hielo (s[ií]|no)\b/i, saysHandedOff],
    },
  },
  {
    id: "confirm-during-reception-handoff",
    description:
      "An open handoff to reception: a confirmation is still the assistant's, and its reply goes",
    number: "onePatient",
    history: [reminder, { role: "patient", text: "me duele la muela de abajo hace dos días" }],
    openHandoffs: ["unmatchedHealthQuestion"],
    patient: ["ah y el jueves voy, confirmado"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: noHandoff,
      judgement: plain,
      told: "reply",
      replyMatches: [/confirm/i],
      replyAvoids: [/muela/i, promisesOrRedirects],
    },
  },
  {
    id: "repeat-during-reception-handoff",
    description:
      "An open handoff to reception: asked about the handed-off toothache again, it says it passed it on and opens nothing",
    number: "onePatient",
    history: [{ role: "patient", text: "me duele la muela de abajo hace dos días" }],
    openHandoffs: ["unmatchedHealthQuestion"],
    patient: ["y entonces qué hago con la muela?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: { healthQuestion: true, emergency: false },
      told: "repeat",
      replyAvoids: [givesAdvice, saysNormal, promisesOrRedirects, saysHandedOff],
    },
  },
  {
    id: "confirm-and-repeat-during-reception-handoff",
    description:
      "An open handoff to reception: a confirmation and a repeat about the toothache in one message; the reply states the confirmation, and underthing then says a person has the toothache",
    number: "onePatient",
    history: [reminder, { role: "patient", text: "me duele la muela de abajo hace dos días" }],
    openHandoffs: ["unmatchedHealthQuestion"],
    patient: ["el jueves voy, confirmado. y con la muela qué hago?"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: noHandoff,
      judgement: { healthQuestion: true, emergency: false },
      told: "repeat",
      replyMatches: [/confirm/i],
      replyAvoids: [givesAdvice, saysNormal, promisesOrRedirects, saysHandedOff],
    },
  },
  {
    id: "repeat-during-patient-asked-handoff",
    description:
      "An open handoff for a person: asked again whether someone will write, it opens nothing and says nothing itself, and underthing says a person has it",
    number: "onePatient",
    history: [{ role: "patient", text: "quiero hablar con alguien de la recepción" }],
    openHandoffs: ["patientAsked"],
    patient: ["me van a contactar?"],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
      told: "repeat",
      replyAvoids: [promisesOrRedirects, saysHandedOff],
    },
  },
  {
    id: "confirm-and-toothache",
    description:
      "A mixed burst: the confirmation is done and said; the toothache, which the kinesiology appointment's practitioner does not treat, goes to reception",
    number: "onePatient",
    history: [reminder],
    patient: ["Hola, quería confirmar el turno del jueves", "Me sigue doliendo la muela de abajo"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: null },
      told: "reply",
      replyMatches: [/confirm/i],
      replyAvoids: [saysNormal, givesAdvice, promisesOrRedirects, /muela/i],
    },
  },
  {
    id: "confirm-and-knee",
    description:
      "A mixed burst: the confirmation is done and said; the knee pain after a session goes to the kinesiologist who treats it",
    number: "onePatient",
    history: [reminder],
    patient: [
      "Hola, quería confirmar el turno del jueves",
      "Desde la última sesión me sigue doliendo la rodilla, es normal?",
    ],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: { reasons: ["clinical"] },
      judgement: { healthQuestion: true, emergency: false, treatedBy: "apt-101" },
      told: "both",
      replyMatches: [/confirm/i],
      replyAvoids: [saysNormal, givesAdvice, /hielo|reposo/i, promisesOrRedirects],
    },
  },
  {
    id: "move-and-refused-move",
    description:
      "One turn moves one appointment and is refused another: the reply states only the move (#237)",
    number: "twoAppointments",
    history: [moveProposal],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    patient: ["sí, dale. y el de mañana a la mañana también lo podés pasar?"],
    expect: {
      calls: [
        { name: "accept_proposal", accepts: "move" },
        { name: "find_free_times", args: { appointmentId: "apt-102" } },
      ],
      handoff: { reasons: ["rule_refused"] },
      judgement: plain,
      told: "reply",
      replyMatches: [/17\/11|martes|10[:.]30/i],
      replyAvoids: [
        /no (se )?(puede|pude|podemos|es posible)|regla|24 ?h|una vez|persona|equipo|alguien/i,
      ],
    },
  },
  {
    id: "thumbs-up-after-proposal",
    description: "Reactions: a message holding only 👍 after the move proposal is the yes (#292)",
    number: "onePatient",
    history: movingToTuesday,
    patient: ["👍"],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      calls: [{ name: "accept_proposal", accepts: "move" }],
      forbidden: ["propose_change"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-reaction-on-proposal",
    description: "Reactions: a 👍 reaction on the move proposal is the yes (#292)",
    number: "onePatient",
    history: movingToTuesday,
    patient: [reactionLine("👍", moveProposal.text)],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      calls: [{ name: "accept_proposal", accepts: "move" }],
      forbidden: ["propose_change"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-on-older-message",
    description:
      "Reactions: a 👍 on the times offered before the proposal asks for nothing, and accepts nothing (#292)",
    number: "onePatient",
    history: movingToTuesday,
    patient: [reactionLine("👍", offeredSlots.text)],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    // The model never reads a reaction taken back (`src/organization/reactions.ts`):
    // the patient's 👍 on the proposal, removed, leaves the conversation as it was.
    id: "hesitation-after-reaction-taken-back",
    description:
      "Reactions: after a 👍 on the proposal taken back, a hesitation accepts nothing (#292)",
    number: "onePatient",
    history: movingToTuesday,
    patient: ["esperá, lo consulto y te aviso"],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-reaction-on-reminder",
    description:
      "Reactions: a 👍 on a reminder that asks to confirm confirms, proposed and accepted in the turn (#292)",
    number: "onePatient",
    history: [reminder],
    patient: [reactionLine("👍", reminder.text)],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-after-reminder",
    description:
      "Reactions: a message holding only 👍 after a reminder that asks to confirm confirms (#292)",
    number: "onePatient",
    history: [reminder],
    patient: ["👍"],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal", accepts: "confirm" },
      ],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-on-booking-confirmation",
    description:
      "Reactions: a 👍 on a message that does not ask to confirm, the booking's, confirms nothing (#292)",
    number: "onePatient",
    history: [bookingConfirmation],
    patient: [reactionLine("👍", bookingConfirmation.text)],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-on-older-reminder",
    description:
      "Reactions: a late 👍 on the reminder, with a move proposal waiting after it, confirms nothing (#292)",
    number: "onePatient",
    history: movingToTuesday,
    patient: [reactionLine("👍", reminder.text)],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
  {
    id: "thumbs-up-on-reminder-already-confirmed",
    description:
      "Reactions: a 👍 on the reminder of an appointment already confirmed changes nothing (#292)",
    number: "alreadyConfirmed",
    history: [reminder],
    patient: [reactionLine("👍", reminder.text)],
    expect: {
      forbidden: ["propose_change", "accept_proposal"],
      handoff: noHandoff,
      judgement: plain,
    },
  },
];

export function findCase(id: string): Case {
  const found = cases.find((each) => each.id === id);
  if (!found) throw new Error(`No evaluation case ${id}`);
  return found;
}
