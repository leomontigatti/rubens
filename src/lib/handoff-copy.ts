import type { HandoffReason } from "#/lib/handoffs.ts";

// What the app says about a handoff (ui: "Derivación"): why the assistant
// passed the conversation to a person, in the inbox and in its notification.
// It names the reason only, never the patient's words.

export const handoffReasonLabels: Record<HandoffReason, string> = {
  patientAsked: "Pidió hablar con una persona",
  ruleRefused: "Pidió un cambio que las reglas no permiten",
  organizationCancelled: "Pide otro horario para un turno que cancelamos",
  clinical: "Consulta clínica",
  emergency: "Posible urgencia",
  followUpAnswer: "Respuesta al seguimiento",
  misunderstoodTwice: "El asistente no lo entendió dos veces seguidas",
  unknownNumber: "Número que no es de ningún paciente",
  noUpcomingAppointment: "Sin turnos próximos",
};
