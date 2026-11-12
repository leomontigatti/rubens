import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { formatShortDay, formatTime } from "#/lib/dates.ts";
import { handoffReasonLabel } from "#/lib/handoff-copy.ts";
import type { HandoffDetail, HandoffReason } from "#/lib/handoffs.ts";
import type { NotificationKind } from "#/lib/notifications.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
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
    /** The patient it is about, by name; `null` for a number of no patient. */
    patient: string | null;
    /** What the turn that made it knew of a refused move and its own changes. */
    detail: HandoffDetail | null;
  } | null;
  /** The patient an `optOut` or `optOutReminder` notification is about. */
  patient: { id: string; name: string } | null;
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
  return format(instant, "dd/MM/yyyy HH:mm", { in: tz(defaultTimeZone) });
}

function day(instant: number) {
  return format(instant, "EEEE d 'de' MMMM 'a las' HH:mm", {
    in: tz(defaultTimeZone),
    locale: es,
  });
}

function template(facts: NotificationFacts) {
  const label = facts.templateName ?? "una plantilla";
  return `${label} (versión ${facts.templateVersion ?? "?"})`;
}

/** The titles that say the same whatever the event held. */
const fixedTitles: Partial<Record<NotificationKind, string>> = {
  numberRestricted: "Meta restringió el número de WhatsApp",
  numberDisabled: "Meta deshabilitó la cuenta de WhatsApp",
  numberRateLimited: "Meta frenó los envíos del número de WhatsApp",
  messagingLimitLowered: "Meta bajó el límite de mensajes del número",
  handoff: "Te derivaron una conversación de WhatsApp",
  handoffReminder: "Una derivación de WhatsApp sigue sin respuesta",
  replyNotDelivered: "Tu respuesta de WhatsApp no le llegó al paciente",
  emergency: "Posible urgencia en una conversación que tomaste",
};

/** The texts that say the same whatever the event held. */
const fixedTexts: Partial<Record<NotificationKind, string>> = {
  templatePaused:
    "Meta la pausa cuando los pacientes la reportan o la bloquean. Vuelve a salir cuando Meta la reactive.",
  numberDisabled: "No puede enviar mensajes hasta que Meta la rehabilite.",
  replyNotDelivered:
    "La escribiste con la ventana de conversación cerrada, y no pudimos reabrirla: el paciente no respondió a tiempo la plantilla, o no se le pudo enviar. Si sigue haciendo falta, respondele cuando vuelva a escribir o contactalo por otro medio.",
  emergency:
    "El asistente le envió al paciente el mensaje de urgencia, con el 107 y el teléfono del consultorio. Respondele cuanto antes.",
  replyFailed:
    "WhatsApp no pudo entregarla, y queda como No entregado en la conversación. Si respondía una derivación, la derivación volvió a quedar abierta.",
  optOut:
    "Sus recordatorios y avisos quedan en espera hasta que decidas en su ficha: Dejar de enviar por WhatsApp, o Seguir enviando.",
  optOutReminder:
    "Sus recordatorios y avisos quedan en espera hasta que decidas en su ficha: Dejar de enviar por WhatsApp, o Seguir enviando.",
  appointmentCancelled:
    "Lo canceló por WhatsApp con el asistente, y el horario quedó libre para otro paciente.",
};

export function notificationTitle(facts: NotificationFacts): string {
  const fixed = fixedTitles[facts.kind];
  if (fixed) {
    return fixed;
  }
  switch (facts.kind) {
    case "templateRejected":
      return `Meta rechazó la plantilla ${template(facts)}`;
    case "templatePaused":
      return `Meta pausó la plantilla ${template(facts)}`;
    case "templateDisabled":
      return `Meta deshabilitó la plantilla ${template(facts)}`;
    case "templateRecategorized":
      return `Meta pasó la plantilla ${template(facts)} a ${categoryLabels[facts.detail ?? ""] ?? facts.detail}`;
    case "replyFailed":
      return facts.patient
        ? `Tu respuesta a ${facts.patient.name} no se entregó`
        : "Tu respuesta al paciente no se entregó";
    case "optOut":
      return `${facts.patient?.name ?? "Un paciente"} pidió no recibir más mensajes de WhatsApp`;
    case "optOutReminder":
      return `Falta decidir si ${facts.patient?.name ?? "un paciente"} sigue recibiendo mensajes de WhatsApp`;
    case "appointmentCancelled":
      return cancelledTitle(facts.appointment);
    default:
      // Every other kind's title is fixed, above.
      return "";
  }
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
        ? "No puede iniciar conversaciones hasta que Meta levante la restricción."
        : `No puede iniciar conversaciones hasta el ${day(facts.until)}.`;
    case "numberRateLimited":
      return `Meta rechazó envíos por exceso de mensajes. underthing vuelve a intentar el ${day(facts.until ?? Date.now())}.`;
    case "messagingLimitLowered":
      return `Ahora puede iniciar conversaciones con hasta ${messagingLimitLabels[facts.detail ?? ""] ?? facts.detail}.`;
    case "handoff":
      return handoffText(facts.handoff);
    case "handoffReminder":
      return reminderText(facts);
    default:
      // Every other kind's text is fixed, above.
      return "";
  }
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

/** Why the conversation was handed off, so its reader answers without reading it back. */
function handoffWhy(handoff: HandoffFacts) {
  const refused = handoff.reason === "ruleRefused" ? handoff.detail?.refused : null;
  const who = handoff.patient ?? "El paciente";
  if (refused) {
    const appointment = `el turno del ${refused.date} ${refused.time}`;
    return refused.why === "pastCutoff"
      ? `${who} quiere pasar ${appointment} y falta menos de ${refused.cutoffHours} h.`
      : `${who} quiere pasar ${appointment}, que ya movió una vez.`;
  }
  const label = handoffReasonLabel(handoff.reason, handoff.detail?.media);
  return handoff.patient ? `${label}: ${handoff.patient}.` : `${label}.`;
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
  return `${handoffWhy(facts.handoff)} ${closes}. Respondé antes para que tu respuesta le llegue enseguida.`;
}

/** How many messages waited when it happened, and what becomes of them; nothing for a kind that holds none. */
export function waitingText(waiting: number | null): string | null {
  if (waiting === null) {
    return null;
  }
  if (waiting === 0) {
    return "Ningún mensaje espera por esto.";
  }
  const count = waiting === 1 ? "1 mensaje espera" : `${waiting} mensajes esperan`;
  return `${count} para salir. Salen en cuanto se pueda, salvo los que ya no correspondan, y no se envían por otro medio.`;
}
