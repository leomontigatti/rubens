import type { HandoffReason } from "#/lib/handoffs.ts";
import type { MediaType } from "#/lib/whatsapp-messages.ts";

// What the app says about a handoff (ui: "Derivación"): why the assistant
// passed the conversation to a person, in the inbox and in its notification.
// It names the reason only, never the patient's words.

const handoffReasonLabels: Record<HandoffReason, string> = {
  patientAsked: "Pidió hablar con una persona",
  ruleRefused: "Pidió un cambio que las reglas no permiten",
  organizationCancelled: "Pide otro horario para un turno que cancelamos",
  clinical: "Consulta para el profesional",
  emergency: "Posible urgencia",
  followUpAnswer: "Respuesta al seguimiento",
  misunderstoodTwice: "El asistente no lo entendió dos veces seguidas",
  voiceUnintelligible: "No se entendió su nota de voz",
  unknownNumber: "Número que no es de ningún paciente",
  noUpcomingAppointment: "Sin turnos próximos",
  heldReply: "Respuesta retenida",
  windowClosed: "La ventana se cerró antes de la respuesta del asistente",
  modelUnavailable: "El asistente no pudo leer el mensaje",
  media: "Mandó una foto, un video o un archivo",
  healthQuestion: "Consulta de salud que no es de su profesional",
};

const mediaNames: Record<MediaType, string> = {
  image: "una foto",
  video: "un video",
  document: "un archivo",
};

/**
 * Why the handoff was made, as the app says it: for a photo, a video or a
 * file, only what the patient sent (`Mandó una foto`, `Mandó una foto y un
 * archivo`); a handoff that kept none of it says all three.
 */
export function handoffReasonLabel(reason: HandoffReason, media: readonly MediaType[] = []) {
  const names = [...new Set(media)].map((type) => mediaNames[type]);
  if (reason !== "media" || names.length === 0) {
    return handoffReasonLabels[reason];
  }
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
  return `Mandó ${listed}`;
}
