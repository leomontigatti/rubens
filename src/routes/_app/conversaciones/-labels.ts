import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import type { WhatsappMessageStatus } from "#/lib/whatsapp-messages.ts";
import type { ConversationSummary, InboxMessage } from "#/organization/inbox.ts";

// How the inbox writes a message, in the list and in the conversation. A
// withheld message arrives with no words: it shows only why.

const withheldLabels = {
  notJudged: "Hay un mensaje esperando ser leído.",
  clinical: "Hay un mensaje clínico. Solo lo leen los profesionales.",
} as const;

export const statusLabels: Record<WhatsappMessageStatus, string> = {
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

// Organizations have no zone of their own yet, and a message belongs to no
// office; every office starts in this one.
export function messageTime(sentAt: number) {
  return format(sentAt, "dd/MM/yyyy HH:mm", { in: tz(defaultTimeZone) });
}

/** The message's words, or what stands in their place. */
export function messageText(message: InboxMessage) {
  if (message.withheld !== null) {
    return withheldLabels[message.withheld];
  }
  return message.text ?? `Mensaje sin texto (${message.type})`;
}

/** Who wrote the message: the patient, a template, the member who replied, or the assistant. */
export function messageSender(message: InboxMessage) {
  if (message.direction === "incoming") {
    return "Paciente";
  }
  if (message.withheld !== null) {
    return "Profesional";
  }
  if (message.type === "template") {
    return "Plantilla";
  }
  return message.sentBy ?? "Asistente";
}

/** Who the conversation is with: its patients, or its number when it stands for none. */
export function conversationName(conversation: Pick<ConversationSummary, "phone" | "patients">) {
  return conversation.patients.length > 0
    ? conversation.patients.map((patient) => patient.name).join(", ")
    : formatPhone(conversation.phone);
}
