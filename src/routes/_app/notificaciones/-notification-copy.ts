import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { handoffReasonLabels } from "#/lib/handoff-copy.ts";
import type { HandoffReason } from "#/lib/handoffs.ts";
import type { NotificationKind } from "#/lib/notifications.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { messagingLimitLabels } from "#/lib/whatsapp.ts";
import { rejectionText, templateLabels } from "#/lib/whatsapp-template-copy.ts";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";

// What a notification says, from what the object kept of the event
// (`src/organization/notifications.ts`): its title, what it means and what
// to do, and how many messages wait. Times read in Buenos Aires, the
// organization's default zone, since a warning about the number is about no office.

export interface NotificationFacts {
  kind: NotificationKind;
  templateName: TemplateName | null;
  templateVersion: number | null;
  detail: string | null;
  until: number | null;
  waiting: number | null;
  /** The handoff a `handoff` notification tells of. */
  handoff: { conversationId: string; reason: HandoffReason; clinical: boolean } | null;
}

const categoryLabels: Record<string, string> = {
  MARKETING: "marketing",
  AUTHENTICATION: "autenticación",
};

const resubmit = "Enviá una versión nueva desde la configuración de WhatsApp.";

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
  const label = facts.templateName ? templateLabels[facts.templateName] : "una plantilla";
  return `${label} (versión ${facts.templateVersion ?? "?"})`;
}

export function notificationTitle(facts: NotificationFacts): string {
  switch (facts.kind) {
    case "templateRejected":
      return `Meta rechazó la plantilla ${template(facts)}`;
    case "templatePaused":
      return `Meta pausó la plantilla ${template(facts)}`;
    case "templateDisabled":
      return `Meta deshabilitó la plantilla ${template(facts)}`;
    case "templateRecategorized":
      return `Meta pasó la plantilla ${template(facts)} a ${categoryLabels[facts.detail ?? ""] ?? facts.detail}`;
    case "numberRestricted":
      return "Meta restringió el número de WhatsApp";
    case "numberDisabled":
      return "Meta deshabilitó la cuenta de WhatsApp";
    case "numberRateLimited":
      return "Meta frenó los envíos del número de WhatsApp";
    case "messagingLimitLowered":
      return "Meta bajó el límite de mensajes del número";
    case "handoff":
      return "Te derivaron una conversación de WhatsApp";
  }
}

export function notificationText(facts: NotificationFacts): string {
  switch (facts.kind) {
    case "templateRejected":
      return `${facts.detail ? rejectionText(facts.detail) : "Meta no dio el motivo."} ${resubmit}`;
    case "templatePaused":
      return "Meta la pausa cuando los pacientes la reportan o la bloquean. Vuelve a salir cuando Meta la reactive.";
    case "templateDisabled":
      return `Ya no se puede usar. ${resubmit}`;
    case "templateRecategorized":
      return `Cuesta más del doble que una de utilidad, así que underthing deja de enviarla. ${resubmit}`;
    case "numberRestricted":
      return facts.until === null
        ? "No puede iniciar conversaciones hasta que Meta levante la restricción."
        : `No puede iniciar conversaciones hasta el ${day(facts.until)}.`;
    case "numberDisabled":
      return "No puede enviar mensajes hasta que Meta la rehabilite.";
    case "numberRateLimited":
      return `Meta rechazó envíos por exceso de mensajes. underthing vuelve a intentar el ${day(facts.until ?? Date.now())}.`;
    case "messagingLimitLowered":
      return `Ahora puede iniciar conversaciones con hasta ${messagingLimitLabels[facts.detail ?? ""] ?? facts.detail}.`;
    case "handoff":
      return handoffText(facts.handoff);
  }
}

function handoffText(handoff: NotificationFacts["handoff"]) {
  if (!handoff) {
    return "La derivación ya no está disponible.";
  }
  const answer =
    "El asistente no responde en esa conversación mientras la derivación siga abierta.";
  return `${handoffReasonLabels[handoff.reason]}. ${answer}`;
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
