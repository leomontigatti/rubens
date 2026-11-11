import { tz } from "@date-fns/tz";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";

import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import type { ConversationSummary, InboxMessage } from "#/organization/inbox.ts";

// How the inbox writes a message, in the list and in the conversation. A
// withheld message arrives with no words: it shows only why.

const withheldLabels = {
  notJudged: "Mensaje sin revisar. Se muestra cuando el asistente lo revise.",
  clinical: "Hay un mensaje clínico. Solo lo leen los profesionales.",
} as const;

const inOffices = { in: tz(defaultTimeZone) };

// Organizations have no zone of their own yet, and a message belongs to no
// office; every office starts in this one.
export function messageTime(sentAt: number) {
  return format(sentAt, "dd/MM/yyyy HH:mm", inOffices);
}

/** The time a bubble shows, `17:31`: its day is the separator above it. */
export function messageClock(sentAt: number) {
  return format(sentAt, "HH:mm", inOffices);
}

/** The day of `at`, in the offices' zone, as `2026-11-10`. */
function dayOf(at: number) {
  return format(at, "yyyy-MM-dd", inOffices);
}

/** The chat's separator for the day of `at`: `Hoy`, `Ayer`, or `Martes 10 de noviembre`, with its year when not this one's. */
export function dayLabel(at: number, now: number) {
  const day = dayOf(at);
  if (day === dayOf(now)) {
    return "Hoy";
  }
  if (day === dayOf(subDays(now, 1, inOffices).getTime())) {
    return "Ayer";
  }
  const sameYear = day.slice(0, 4) === dayOf(now).slice(0, 4);
  const written = format(at, sameYear ? "EEEE d 'de' MMMM" : "EEEE d 'de' MMMM 'de' yyyy", {
    ...inOffices,
    locale: es,
  });
  return written.charAt(0).toUpperCase() + written.slice(1);
}

/** `items`, in their order, split where the day of `at` changes, each run under its separator. */
export function byDay<Item>(items: Item[], at: (item: Item) => number, now: number) {
  const days: { label: string; items: Item[] }[] = [];
  let current: string | null = null;
  for (const item of items) {
    const day = dayOf(at(item));
    if (day !== current) {
      days.push({ label: dayLabel(at(item), now), items: [] });
      current = day;
    }
    days.at(-1)!.items.push(item);
  }
  return days;
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
