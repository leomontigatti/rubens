import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import { Badge } from "#/components/ui/badge.tsx";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import type { WhatsappMessageStatus } from "#/lib/whatsapp-messages.ts";
import type { ConversationSummary, InboxMessage } from "#/organization/inbox.ts";

// How the inbox writes a message, in the list and in the conversation. A
// withheld message arrives with no words: it shows only why.

export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede leer las conversaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos esa conversación.",
  notFound: "No encontramos esa conversación, o no es sobre tus turnos.",
};

const withheldLabels = {
  notJudged: "Hay un mensaje esperando ser leído.",
  clinical: "Hay un mensaje clínico. Solo lo leen los profesionales.",
} as const;

const statusLabels: Record<WhatsappMessageStatus, string> = {
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

// Organizations have no zone of their own yet; their offices default to this one.
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

/** An outgoing message's delivery, as a badge; failed is the one to act on. */
export function StatusBadge({ message }: { message: InboxMessage }) {
  if (message.withheld !== null || message.status === null) {
    return null;
  }
  return (
    <Badge variant={message.status === "failed" ? "destructive" : "secondary"}>
      {statusLabels[message.status]}
    </Badge>
  );
}

/** Who the conversation is with: its patients, or its number when it stands for none. */
export function conversationName(conversation: Pick<ConversationSummary, "phone" | "patients">) {
  return conversation.patients.length > 0
    ? conversation.patients.map((patient) => patient.name).join(", ")
    : formatPhone(conversation.phone);
}
