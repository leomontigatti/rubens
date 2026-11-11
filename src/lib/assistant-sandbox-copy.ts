import type { AssistantToolName } from "#/lib/assistant.ts";
import type { ProposalKind } from "#/lib/proposals.ts";
import { appointmentDay, appointmentTime } from "#/lib/template-filling.ts";

// The copy of the assistant's sandbox in the WhatsApp settings
// (`src/routes/_app/whatsapp/configuracion/prueba.tsx`): its refusals, what a turn did, and
// the conversation window's countdown.

export const sandboxRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede probar el asistente.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Escribí el mensaje del paciente.",
  notFound: "Ese turno ya no está. Elegí otro para empezar de nuevo.",
  missingApiKey: "Falta la clave del modelo del asistente en la configuración del servidor.",
  rateLimited: "La prueba llegó a su límite de esta hora. Probá de nuevo más tarde.",
  conversationFull: "La conversación de prueba llegó a su largo máximo. Empezá de nuevo.",
};

/** What the assistant did with the patient's message. */
export const sandboxOutcomeLabels = {
  answered: "Respondió.",
  handedOff: "Derivó la conversación a recepción: al paciente no le dice nada de eso.",
  toPractitioner: "Le pasó la consulta al profesional.",
  emergency: "Lo trató como una urgencia.",
  optOutAsked: "Entendió que el paciente no quiere más mensajes: avisaría al equipo.",
  unintelligible: "No entendió la nota de voz: pediría que la escriba.",
  silent: "No respondió: una persona tomó la conversación.",
  unread: "El modelo no pudo leer el mensaje. Escribilo de nuevo.",
} as const;

export const sandboxToolLabels: Record<AssistantToolName, string> = {
  list_patients: "Pacientes del número",
  get_appointment: "Datos del turno",
  judge_messages: "Juicio de los mensajes",
  hand_off: "Derivación",
  find_free_times: "Horarios libres",
  propose_change: "Propuesta",
  accept_proposal: "Aceptación de la propuesta",
};

export const proposalKindLabels: Record<ProposalKind, string> = {
  confirm: "Confirmar",
  cancel: "Cancelar",
  move: "Mover",
};

/** A proposal's statement as the patient read it: the appointment, then a move's new time. */
export function proposalStatement(statement: Record<string, string>) {
  const { medicalService, practitioner, date, time, newDate, newTime } = statement;
  const appointment = `${medicalService} con ${practitioner}, ${date} a las ${time}`;
  return newDate ? `${appointment}, al ${newDate} a las ${newTime}` : appointment;
}

/** A scenario as the picker lists it: the patient, the day and time, the practitioner. */
export function scenarioLabel(scenario: {
  patient: string;
  startsAt: number;
  timeZone: string;
  practitioner: string;
}) {
  const start = new Date(scenario.startsAt);
  const when = `${appointmentDay(start, scenario.timeZone)}, ${appointmentTime(start, scenario.timeZone)}`;
  return `${scenario.patient} · ${when} · ${scenario.practitioner}`;
}

/** The time from `now` to `at`, rounded up to the minute, such as `23 h 05 min`; `null` once it passed. */
function timeLeft(at: number, now: number) {
  const left = at - now;
  if (left <= 0) {
    return null;
  }
  const minutes = Math.ceil(left / 60_000);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** How long the window has left at `now`, such as `Cierra en 23 h 05 min`; `Cerrada` once it closed. */
export function windowCountdown(closesAt: number | null, now: number) {
  if (closesAt === null) {
    return "Sin abrir: el paciente todavía no escribió.";
  }
  const left = timeLeft(closesAt, now);
  return left ? `Cierra en ${left}` : "Cerrada";
}

/** A proposal's state at `now`: accepted, expired, or how long it waits for its yes. */
export function proposalState(
  proposal: { acceptedAt: number | null; expiresAt: number },
  now: number,
) {
  if (proposal.acceptedAt !== null) {
    return { label: "Aceptada", variant: "success" } as const;
  }
  const left = timeLeft(proposal.expiresAt, now);
  return left
    ? ({ label: `Vence en ${left}`, variant: "outline" } as const)
    : ({ label: "Vencida", variant: "secondary" } as const);
}
