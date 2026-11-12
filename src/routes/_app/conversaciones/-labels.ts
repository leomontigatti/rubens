import { tz } from "@date-fns/tz";
import { format, subDays } from "date-fns";

import {
  formatDateTime,
  formatDayHeading,
  formatDayHeadingWithYear,
  formatTime,
} from "#/lib/dates.ts";
import type { MediaKind, MessageMedia } from "#/lib/message-media.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatPhone } from "#/lib/phones.ts";
import { reactionType } from "#/lib/reactions.ts";
import type { ConversationSummary, InboxMessage } from "#/organization/inbox.ts";

// How the inbox writes a message, in the list and in the conversation.

/** What a photo, a video or a file is called, in place of words. */
const mediaLabels: Record<string, string> = {
  image: "Foto",
  video: "Video",
  document: "Archivo",
};

const inOffices = { in: tz(defaultTimeZone) };

// Organizations have no zone of their own yet, and a message belongs to no
// office; every office starts in this one.
export function messageTime(sentAt: number) {
  return formatDateTime(sentAt, defaultTimeZone);
}

/** The time a bubble shows, `17:31`: its day is the separator above it. */
export function messageClock(sentAt: number) {
  return formatTime(sentAt, defaultTimeZone);
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
  return sameYear
    ? formatDayHeading(at, defaultTimeZone)
    : formatDayHeadingWithYear(at, defaultTimeZone);
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
  if (message.type === "audio") {
    if (message.text === null) {
      return "Nota de voz sin transcribir";
    }
    return message.text === ""
      ? "Nota de voz que no se pudo entender"
      : `Nota de voz: ${message.text}`;
  }
  // One whose message the inbox holds shows under it instead (`-chat.tsx`).
  if (message.type === reactionType) {
    return `Reaccionó con ${message.text} a un mensaje anterior`;
  }
  if (message.media?.filename) {
    return `${mediaLabels[message.type] ?? "Archivo"}: ${message.media.filename}`;
  }
  return message.text ?? mediaLabels[message.type] ?? `Mensaje sin texto (${message.type})`;
}

/** The button that opens each kind of media from Meta. */
const mediaActions: Record<MediaKind, string> = {
  audio: "Escuchar",
  image: "Ver foto",
  video: "Ver video",
  document: "Abrir archivo",
};

/** The button that opens `media` at `now`, or `null` once Meta deleted it. */
export function mediaAction(media: MessageMedia, now: number) {
  return now < media.availableUntil ? mediaActions[media.kind] : null;
}

/**
 * Who wrote an outgoing message: a template, the member who replied, or the
 * assistant. None for the patient's: their side of the chat says it.
 */
export function messageSender(message: InboxMessage) {
  if (message.direction === "incoming") {
    return null;
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
