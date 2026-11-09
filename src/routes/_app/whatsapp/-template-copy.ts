import type { TemplateName, TemplateProblem, TemplateStatus } from "#/lib/whatsapp-templates.ts";

// What the WhatsApp settings say about templates: each template's name as a
// person reads it, its status at Meta, and what to fix in a body.

export const templateLabels: Record<TemplateName, string> = {
  confirmacion_turno: "Confirmación del turno",
  recordatorio_turno: "Recordatorio con confirmación",
  recordatorio_turno_sin_confirmacion: "Recordatorio sin confirmación",
  indicaciones: "Indicaciones",
  seguimiento: "Seguimiento",
  turno_movido: "Turno movido",
  turno_cancelado: "Turno cancelado",
  turno_a_reprogramar: "Turno a reprogramar",
  solicitud_no_confirmada: "Solicitud no confirmada",
  reabrir_conversacion: "Reabrir la conversación",
};

export const templateStatusLabels: Record<TemplateStatus, string> = {
  pending: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
  paused: "Pausada",
  disabled: "Deshabilitada",
};

export const templateStatusVariants = {
  pending: "info",
  approved: "success",
  rejected: "destructive",
  paused: "warning",
  disabled: "destructive",
} as const satisfies Record<TemplateStatus, string>;

// Meta's codes for a rejection; one with no copy here shows as Meta wrote it.
const rejectionLabels: Record<string, string> = {
  ABUSIVE_CONTENT: "Meta lo consideró contenido abusivo.",
  INCORRECT_CATEGORY: "Meta considera que no es de la categoría de utilidad.",
  INVALID_FORMAT: "El formato no cumple las reglas de Meta.",
  SCAM: "Meta lo consideró una posible estafa.",
  TAG_CONTENT_MISMATCH: "El texto no coincide con la categoría de utilidad.",
};

export function rejectionText(reason: string) {
  return rejectionLabels[reason] ?? reason;
}

export const templateRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede usar la configuración de WhatsApp.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el texto de la plantilla.",
  connectionFailed: "La conexión del número de WhatsApp falló. Conectalo de nuevo.",
  missingAccessToken: "Todavía no hay un número de WhatsApp conectado.",
  missingBusinessAccountId:
    "Falta el identificador de la cuenta de WhatsApp Business en la configuración del servidor.",
};

const variable = (name: string) => "{{" + name + "}}";

/** What to fix, for each problem the rules check found. */
export function problemText(problem: TemplateProblem): string {
  switch (problem.kind) {
    case "empty":
      return "Escribí el texto de la plantilla.";
    case "tooLong":
      return "El texto tiene " + problem.length + " caracteres, y Meta acepta hasta 1024.";
    case "startsWithVariable":
      return "El texto no puede empezar con una variable: escribí algo antes.";
    case "endsWithVariable":
      return "El texto no puede terminar con una variable: escribí algo después.";
    case "unnamedVariable":
      return (
        variable(problem.variable) + " no tiene nombre: usá una de las variables de la plantilla."
      );
    case "uppercaseVariable":
      return "Escribí " + variable(problem.variable) + " en minúsculas.";
    case "invalidVariable":
      return (
        variable(problem.variable) +
        " no es una variable: usá minúsculas y guiones bajos, sin espacios."
      );
    case "unknownVariable":
      return "Esta plantilla no completa " + variable(problem.variable) + ".";
    case "strayBraces":
      return "Cada variable va entre {{ y }}: revisá las llaves que quedaron abiertas o sueltas.";
    case "signOffPlaceholder":
      return "Reemplazá [firma] por la firma del consultorio.";
  }
}
