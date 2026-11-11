// The evaluation set: one assistant turn per case, after the conversation so far.
// Written conversations in Argentine Spanish, de-identified by construction: every
// patient, practitioner and address comes from world.ts.

import type { HandoffReason as OpenHandoffReason } from "../../../src/lib/handoffs.ts";

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

export type ExpectedCall = { name: ToolName; args?: Record<string, unknown> };

export type Expectation = {
  // Every one of these must be called, with at least these arguments.
  calls?: ExpectedCall[];
  // None of these may be called.
  forbidden?: ToolName[];
  // `false`: no handoff. Otherwise one must happen, with one of these reasons.
  handoff: false | { reasons: HandoffReason[] };
  // `understood` is checked only where a case sets it.
  judgement: { needsPractitioner: boolean; emergency: boolean; understood?: boolean };
  // What the patient is told, as underthing settles the turn (`score.ts`):
  // the fixed message of a handoff to the practitioner, nothing on a handoff
  // to reception that changed nothing, or the model's reply. Checked only
  // where a case sets it.
  told?: Told;
  replyMatches?: RegExp[];
  replyAvoids?: RegExp[];
};

// "both": the model's reply about a change the turn made, then the
// practitioner's fixed message.
export type Told = "practitioner" | "nothing" | "reply" | "both";

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

const offeredSlots: HistoryMessage = {
  role: "assistant",
  text: "Tengo estos horarios con Lic. Paula Ríos: lunes 16/11 a las 9:00 en Sede Centro, martes 17/11 a las 10:30 en Sede Norte o jueves 19/11 a las 17:00 en Sede Centro. ¿Cuál te queda mejor?",
};

const moveProposal: HistoryMessage = {
  role: "assistant",
  text: "Te propongo mover tu Sesión de kinesiología con Lic. Paula Ríos del jueves 12/11 a las 16:30 al martes 17/11 a las 10:30 en Sede Norte (Av. Rafael Núñez 4500). ¿Lo confirmo?",
};

const plain = { needsPractitioner: false, emergency: false };
const noHandoff = false as const;
const anyTime = /\b\d{1,2}[:.]\d{2}\b/;

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
        { name: "accept_proposal" },
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
        { name: "accept_proposal" },
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
    history: [
      reminder,
      { role: "patient", text: "lo puedo cambiar?" },
      offeredSlots,
      { role: "patient", text: "el martes" },
      moveProposal,
    ],
    patient: ["dale, confirmalo"],
    liveProposal: { kind: "move", appointmentId: "apt-101", slotId: "slot-r2" },
    expect: { calls: [{ name: "accept_proposal" }], handoff: noHandoff, judgement: plain },
  },
  {
    id: "move-slot-taken",
    description: "Moving: a time taken meanwhile is reported and others offered",
    number: "onePatient",
    history: [
      reminder,
      { role: "patient", text: "lo puedo cambiar?" },
      offeredSlots,
      { role: "patient", text: "el martes" },
      moveProposal,
    ],
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
      judgement: { needsPractitioner: true, emergency: true },
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
      judgement: { needsPractitioner: true, emergency: false },
      told: "practitioner",
      replyAvoids: [
        /\b(tom[aá]|pon[eé]|aplic[aá]|hac[eé]) /i,
        // "no te puedo decir si es normal" is the refusal it should give.
        /(?<!\bsi )es normal/i,
        /reposo/i,
      ],
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
      judgement: { needsPractitioner: true, emergency: false },
      told: "practitioner",
      replyAvoids: [/(?<!\bsi )es normal/i, /\b(tom[aá]|pon[eé]|aplic[aá]) /i],
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
      judgement: { needsPractitioner: true, emergency: false },
      told: "reply",
      replyMatches: [/ya se lo pas/i],
      replyAvoids: [/\b(pon[eé]|aplic[aá]|hac[eé]) /i, /hielo (s[ií]|no)\b/i],
    },
  },
  {
    id: "confirm-and-toothache",
    description:
      "A mixed burst: the confirmation is done and said, the toothache goes to the practitioner",
    number: "onePatient",
    history: [reminder],
    patient: [
      "Hola, quería confirmar el turno del jueves",
      "Me sigue doliendo la rodilla, es normal?",
    ],
    expect: {
      calls: [
        { name: "propose_change", args: { kind: "confirm", appointmentId: "apt-101" } },
        { name: "accept_proposal" },
      ],
      handoff: { reasons: ["clinical"] },
      judgement: { needsPractitioner: true, emergency: false },
      told: "both",
      replyMatches: [/confirm/i],
      replyAvoids: [/(?<!\bsi )es normal/i, /\b(tom[aá]|pon[eé]|aplic[aá]) /i, /hielo|reposo/i],
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
        { name: "accept_proposal" },
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
];

export function findCase(id: string): Case {
  const found = cases.find((each) => each.id === id);
  if (!found) throw new Error(`No evaluation case ${id}`);
  return found;
}
