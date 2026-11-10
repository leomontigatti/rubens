import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import type { WhatsappMessageStatus } from "#/lib/whatsapp-messages.ts";
import type { ConversationSummary, InboxMessage } from "#/organization/inbox.ts";

// How the inbox writes a message, in the list and in the conversation. A
// withheld message arrives with no words: it shows only why.

const withheldLabels = {
  notJudged: "Mensaje sin revisar. Se muestra cuando el asistente lo revise.",
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

/** The message's words, or what stands in their place: a voice note's are its transcript. */
export function messageText(message: InboxMessage) {
  if (message.withheld !== null) {
    return withheldLabels[message.withheld];
  }
  if (message.type === "audio") {
    if (message.text === null) {
      return "Nota de voz sin transcribir";
    }
    return message.text === ""
      ? "Nota de voz que no se pudo entender"
      : `Nota de voz: ${message.text}`;
  }
  return message.text ?? `Mensaje sin texto (${message.type})`;
}

/**
 * Who wrote an outgoing message: a template, the member who replied, or the
 * assistant. None for the patient's: their side of the chat says it.
 */
export function messageSender(message: InboxMessage) {
  if (message.direction === "incoming") {
    return null;
  }
  if (message.withheld !== null) {
    return "Profesional";
  }
  if (message.type === "template") {
    return "Plantilla";
  }
  return message.sentBy ?? "Asistente";
}

/** The patients the conversation's number stands for, or none when it stands for no patient. */
export function registeredName(conversation: Pick<ConversationSummary, "patients">) {
  return conversation.patients.length > 0
    ? conversation.patients.map((patient) => patient.name).join(", ")
    : null;
}

/** Who the conversation is with: its patients, or its number when it stands for none. */
export function conversationName(conversation: Pick<ConversationSummary, "phone" | "patients">) {
  return registeredName(conversation) ?? formatPhone(conversation.phone);
}
