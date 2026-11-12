import { formatDateTime, formatDay, formatShortDay, formatTime } from "#/lib/dates.ts";
import { handoffReasonLabel } from "#/lib/handoff-copy.ts";
import type { HandoffDetail, HandoffReason } from "#/lib/handoffs.ts";
import type { NotificationKind } from "#/lib/notifications.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import { messagingLimitLabels } from "#/lib/whatsapp.ts";
import { rejectionText } from "#/lib/whatsapp-template-copy.ts";

// What a notification says, from what the object kept of the event
// (`src/organization/notifications.ts`): its title, what it means and what
// to do, and how many messages wait. Times read in Buenos Aires, the
// organization's default zone, since a warning about the number is about no office.

export interface NotificationFacts {
  kind: NotificationKind;
  /** The template's name, as it is now. */
  templateName: string | null;
  templateVersion: number | null;
  detail: string | null;
  until: number | null;
  waiting: number | null;
  /** The handoff a `handoff` or `handoffReminder` notification tells of. */
  handoff: {
    conversationId: string;
    reason: HandoffReason;
    forPractitioner: boolean;
    /** It needs the practitioner, and reached the reader since nobody active keeps clinical records. */
    noPractitioner: boolean;
    /** The patient it is about, by name; `null` for a number of no patient, or of several. */
    patient: string | null;
    /** What the turn that made it knew of a refused move and its own changes. */
    detail: HandoffDetail | null;
  } | null;
  /**
   * The patient an `optOut`, `optOutReminder`, `replyFailed`, `replyNotDelivered`
   * or `emergency` notification is about, with their phone in E.164.
   */
  patient: { id: string; name: string; phone: string } | null;
  /** The patient's message an opt-out's notification links to; `null` for one from before they did. */
  messageId: string | null;
  /** Whether what it asked for was done: an opt-out decided. */
  resolved: boolean;
  /** The appointment an `appointmentCancelled` notification is about, by its patient's and practitioner's names. */
  appointment: {
    patient: string;
    practitioner: string;
    startsAt: number;
    /** Its office's zone, which its time reads in. */
    timeZone: string;
  } | null;
}

const categoryLabels: Record<string, string> = {
  MARKETING: "marketing",
  AUTHENTICATION: "autenticación",
};

const resubmit = "Enviá una versión nueva desde su página en Plantillas.";

export function localTime(instant: number) {
  return formatDateTime(instant, defaultTimeZone);
}

function day(instant: number) {
  return `${formatDay(instant, defaultTimeZone)} a las ${formatTime(instant, defaultTimeZone)}`;
}

function template(facts: NotificationFacts) {
  return facts.templateName ?? "una plantilla";
}

/** The titles that say the same whatever the event held. */
const fixedTitles: Partial<Record<NotificationKind, string>> = {
  numberRestricted: "Meta restringió el número de WhatsApp",
  numberDisabled: "Meta deshabilitó la cuenta de WhatsApp",
  numberRateLimited: "Meta frenó los envíos del número de WhatsApp",
  messagingLimitLowered: "Meta bajó el límite de mensajes del número",
  handoff: "Te derivaron una conversación de WhatsApp",
};

/** The texts that say the same whatever the event held. */
const fixedTexts: Partial<Record<NotificationKind, string>> = {
  templatePaused:
    "Meta la pausa cuando los pacientes la reportan o la bloquean. Vuelve a salir cuando Meta la reactive.",
  numberDisabled: "No puede enviar mensajes hasta que Meta la rehabilite.",
  emergency:
    "El asistente le envió al paciente el mensaje de urgencia, con el 107 y el teléfono de la organización. Respondele cuanto antes.",
  replyFailed:
    "WhatsApp no pudo entregarla, y queda como No entregado en la conversación. Si respondía una derivación, la derivación volvió a quedar abierta.",
  appointmentCancelled:
    "Lo canceló por WhatsApp con el asistente. Mirá en la agenda si podés darle el horario a otro paciente.",
};

type Title = (facts: NotificationFacts) => string;

/** The titles that say what the event held: the template, or the patient by name when known. */
const titles: Partial<Record<NotificationKind, Title>> = {
  templateRejected: (facts) => `Meta rechazó la plantilla ${template(facts)}`,
  templatePaused: (facts) => `Meta pausó la plantilla ${template(facts)}`,
  templateDisabled: (facts) => `Meta deshabilitó la plantilla ${template(facts)}`,
  templateRecategorized: (facts) =>
    `Meta pasó la plantilla ${template(facts)} a ${categoryLabels[facts.detail ?? ""] ?? facts.detail}`,
  replyNotDelivered: ({ patient }) =>
    patient
      ? `Tu respuesta a ${patient.name} no le llegó`
      : "Tu respuesta de WhatsApp no le llegó al paciente",
  replyFailed: ({ patient }) =>
    patient
      ? `Tu respuesta a ${patient.name} no se entregó`
      : "Tu respuesta al paciente no se entregó",
  optOut: ({ patient }) =>
    `${patient?.name ?? "Un paciente"} pidió no recibir más mensajes de WhatsApp`,
  optOutReminder: ({ patient }) =>
    `Falta decidir si ${patient?.name ?? "un paciente"} sigue recibiendo mensajes de WhatsApp`,
  appointmentCancelled: ({ appointment }) => cancelledTitle(appointment),
  handoffReminder: ({ handoff }) =>
    handoff?.patient
      ? `${handoff.patient} sigue esperando respuesta`
      : "Una derivación de WhatsApp sigue sin respuesta",
  emergency: ({ patient }) =>
    patient
      ? `Posible urgencia de ${patient.name} en una conversación que tomaste`
      : "Posible urgencia en una conversación que tomaste",
};

export function notificationTitle(facts: NotificationFacts): string {
  // Every kind has a title in one of the two.
  return fixedTitles[facts.kind] ?? titles[facts.kind]?.(facts) ?? "";
}

export function notificationText(facts: NotificationFacts): string {
  const fixed = fixedTexts[facts.kind];
  if (fixed) {
    return fixed;
  }
  switch (facts.kind) {
    case "templateRejected":
      return `${facts.detail ? rejectionText(facts.detail) : "Meta no dio el motivo."} ${resubmit}`;
    case "templateDisabled":
      return `Ya no se puede usar. ${resubmit}`;
    case "templateRecategorized":
      return `Cuesta más del doble que una de utilidad, así que underthing deja de enviarla. ${resubmit}`;
    case "numberRestricted":
      return facts.until === null
        ? "El número no puede iniciar conversaciones hasta que Meta levante la restricción."
        : `El número no puede iniciar conversaciones hasta el ${day(facts.until)}.`;
    case "numberRateLimited":
      return `Meta rechazó envíos por exceso de mensajes. underthing vuelve a intentar el ${day(facts.until ?? Date.now())}.`;
    case "messagingLimitLowered":
      return `Ahora puede iniciar conversaciones con hasta ${messagingLimitLabels[facts.detail ?? ""] ?? facts.detail}.`;
    case "handoff":
      return handoffText(facts.handoff);
    case "handoffReminder":
      return reminderText(facts);
    case "replyNotDelivered":
      return notDeliveredText(facts.patient);
    case "optOut":
    case "optOutReminder":
      return optOutText(facts);
    default:
      // Every other kind's text is fixed, above.
      return "";
  }
}

/** Where an opt-out is decided: under the patient's message, or on the record for one that links to none. */
function optOutText(facts: NotificationFacts) {
  if (facts.messageId === null) {
    return facts.resolved
      ? "Ya se decidió en su ficha."
      : "Sus recordatorios y avisos quedan en espera hasta que decidas en su ficha: Dejar de enviar por WhatsApp, o Seguir enviando.";
  }
  return facts.resolved
    ? "Ya se decidió: lo ves debajo de su mensaje en la conversación."
    : "Sus recordatorios y avisos quedan en espera hasta que alguien decida, debajo de su mensaje en la conversación: Dejar de enviar o Seguir enviando.";
}

function cancelledTitle(appointment: NotificationFacts["appointment"]) {
  if (!appointment) {
    return "Un paciente canceló su turno";
  }
  const { patient, practitioner, startsAt, timeZone } = appointment;
  const when = `${formatShortDay(startsAt, timeZone)} ${formatTime(startsAt, timeZone)}`;
  return `${patient} canceló su turno del ${when} con ${practitioner}`;
}

type HandoffFacts = NonNullable<NotificationFacts["handoff"]>;

const appliedVerbs = { confirm: "confirmó", cancel: "canceló", move: "pasó" } as const;

/**
 * Why the conversation was handed off, so its reader answers without reading
 * it back; with the patient after the reason unless `named` elsewhere, as a
 * reminder's title names them.
 */
function handoffWhy(handoff: HandoffFacts, named = false) {
  const refused = handoff.reason === "ruleRefused" ? handoff.detail?.refused : null;
  const who = handoff.patient ?? "El paciente";
  if (refused) {
    const appointment = `el turno del ${refused.date} ${refused.time}`;
    return refused.why === "pastCutoff"
      ? `${who} quiere pasar ${appointment} y falta menos de ${refused.cutoffHours} h.`
      : `${who} quiere pasar ${appointment}, que ya movió una vez.`;
  }
  const label = handoffReasonLabel(handoff.reason, handoff.detail?.media);
  return handoff.patient && !named ? `${label}: ${handoff.patient}.` : `${label}.`;
}

/** What the turn that handed it off did anyway, so the reader does not undo or repeat it. */
function appliedText(applied: HandoffDetail["applied"]) {
  return applied.map((change) => {
    const from = `el turno del ${change.date} ${change.time}`;
    const to = change.newDate ? ` al ${change.newDate} ${change.newTime}` : "";
    return ` El asistente ya le ${appliedVerbs[change.kind]} ${from}${to}.`;
  });
}

function handoffText(handoff: NotificationFacts["handoff"]) {
  if (!handoff) {
    return "La derivación ya no está disponible.";
  }
  const why = `${handoffWhy(handoff)}${appliedText(handoff.detail?.applied ?? []).join("")}`;
  if (handoff.noPractitioner) {
    return `${why} Te llegó porque ningún profesional activo lleva historias clínicas: elegí los contactos de derivación para que la reciba uno.`;
  }
  return why;
}

function reminderText(facts: NotificationFacts) {
  if (!facts.handoff) {
    return "La derivación ya no está disponible.";
  }
  const closes =
    facts.until === null
      ? "La ventana de WhatsApp cierra pronto"
      : `La ventana de WhatsApp cierra el ${day(facts.until)}`;
  return `${handoffWhy(facts.handoff, true)} ${closes}. Respondé antes para que tu respuesta le llegue enseguida.`;
}

/** Why a late reply did not reach the patient, and the phone to reach them another way. */
function notDeliveredText(patient: NotificationFacts["patient"]) {
  const other = patient
    ? `contactalo por otro medio, al ${formatPhone(patient.phone)}`
    : "contactalo por otro medio";
  return `La escribiste con la ventana de conversación cerrada, y no pudimos reabrirla: el paciente no respondió a tiempo la plantilla, o no se le pudo enviar. Si sigue haciendo falta, respondele cuando vuelva a escribir o ${other}.`;
}

/** How many messages waited when it happened, and that they go once it lifts; nothing when none did. */
export function waitingText(waiting: number | null): string | null {
  if (!waiting) {
    return null;
  }
  return waiting === 1
    ? "1 mensaje espera y sale cuando se levante."
    : `${waiting} mensajes esperan y salen cuando se levante.`;
}
