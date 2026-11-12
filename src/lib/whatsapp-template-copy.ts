import type { Timing } from "#/lib/template-timing.ts";
import type {
  EventTemplateId,
  TemplateCategory,
  TemplateProblem,
  TemplateStatus,
} from "#/lib/whatsapp-templates.ts";

// What the WhatsApp settings say about templates: when each goes, its status
// at Meta, and what to fix in a body.

/** An event template's event, which the list shows where the others show their timing. */
export const eventLabels: Record<EventTemplateId, string> = {
  turno_movido: "Cuando la organización mueve un turno",
  turno_cancelado: "Cuando la organización cancela un turno",
  turno_a_reprogramar: "Cuando un turno queda para reprogramar",
  solicitud_no_confirmada: "Cuando no se confirma un turno pedido",
  reabrir_conversacion: "Cuando se responde con la conversación cerrada",
};

function count(amount: number, one: string, many: string) {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** A span of hours as the admin set it: in days when it is whole days. */
function timingSpan(hours: number) {
  return hours % 24 === 0 ? count(hours / 24, "día", "días") : count(hours, "hora", "horas");
}

/** When a template goes, as the list and the medical service's form say it. */
export function timingLabel(timing: Timing): string {
  switch (timing.when) {
    case "booking":
      return "Al dar el turno";
    case "attended":
      return "Al atender el turno";
    case "before":
      return `${timingSpan(timing.hours)} antes del turno`;
    case "after":
      return `${timingSpan(timing.hours)} después del turno`;
  }
}

export const templateStatusLabels: Record<TemplateStatus, string> = {
  pending: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
  paused: "Pausada",
  disabled: "Deshabilitada",
};

/** A template of the set no version of which was ever submitted. */
export const unsentLabel = "Sin enviar";

export const templateCategoryLabels: Record<TemplateCategory, string> = {
  utility: "Utilidad",
  marketing: "Marketing",
  authentication: "Autenticación",
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

const connectNumber = "Conectá el número de la organización.";

export const templateRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede usar la configuración de WhatsApp.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el texto de la plantilla.",
  connectionFailed: "La conexión del número de WhatsApp falló. Conectalo de nuevo.",
  // What the Worker misses is logged for whoever runs it (`src/organization/whatsapp.ts`).
  missingAccessToken: connectNumber,
  missingBusinessAccountId: connectNumber,
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
    case "openingMark":
      return "Sacá el ¿ y el ¡ de apertura: la organización escribe sin ellos, como el asistente.";
    case "emoji":
      return "Sacá los emojis: los mensajes de la organización no los llevan, como los del asistente.";
  }
}
