import type { TemplateName } from "#/lib/whatsapp-templates.ts";

// The outbox: every message to a patient is a row queued in the transaction
// that changes the appointment (docs/domain/messages.md § To staff), and the
// organization's alarm sends what is due (ADR-0008 § Jobs are Durable Object
// alarms). It holds the booking confirmation, the reminders, the care
// instructions, the follow-up, and the messages for an appointment the
// organization changed; and the reopen template, about a conversation rather
// than an appointment, for a person's reply written after its window closed
// (`src/organization/late-replies.ts`).

/** What a queued message is, each sent as its template. */
export const outboxKinds = [
  "bookingConfirmation",
  "reminder",
  "reminderWithoutConfirmation",
  "careInstructions",
  "followUp",
  "appointmentMoved",
  "appointmentCancelled",
  "appointmentToReschedule",
  "reopenConversation",
] as const;

export type OutboxKind = (typeof outboxKinds)[number];

export const outboxTemplates = {
  bookingConfirmation: "confirmacion_turno",
  reminder: "recordatorio_turno",
  reminderWithoutConfirmation: "recordatorio_turno_sin_confirmacion",
  careInstructions: "indicaciones",
  followUp: "seguimiento",
  appointmentMoved: "turno_movido",
  appointmentCancelled: "turno_cancelado",
  appointmentToReschedule: "turno_a_reprogramar",
  reopenConversation: "reabrir_conversacion",
} as const satisfies Record<OutboxKind, TemplateName>;

/** The kinds that are a reminder: one asks the patient to confirm, the other does not. */
export const reminderKinds = [
  "reminder",
  "reminderWithoutConfirmation",
] as const satisfies readonly OutboxKind[];

/** The kinds sent after an appointment was attended: of all, only these go however late. */
export const aftercareKinds = [
  "careInstructions",
  "followUp",
] as const satisfies readonly OutboxKind[];

/**
 * The kinds that tell the patient the organization changed their appointment:
 * only the one for its latest change goes.
 */
export const changeKinds = [
  "appointmentMoved",
  "appointmentCancelled",
  "appointmentToReschedule",
] as const satisfies readonly OutboxKind[];

/** When a reminder set `hoursBefore` an appointment starting at `startsAt` goes. */
export function reminderDueAt(startsAt: number, hoursBefore: number) {
  return startsAt - hoursBefore * 60 * 60_000;
}

/** When a follow-up set `hoursAfter` an appointment ending at `endsAt` goes. */
export function followUpDueAt(endsAt: number, hoursAfter: number) {
  return endsAt + hoursAfter * 60 * 60_000;
}

/**
 * Where a queued message stands: waiting to go, sent, dropped because it is
 * no longer true or no longer allowed, or failed for good after its retries.
 */
export const outboxStates = ["queued", "sent", "dropped", "failed"] as const;

/**
 * Why a message was dropped before it went: its appointment changed, its
 * patient withdrew consent, a later reminder for the same appointment was due
 * too (docs/domain/messages.md § When Meta limits the number), the care
 * instructions it carries were cleared from the medical service, or, for the
 * reopen template, the patient wrote first, so the replies it waited for went
 * without it, or the last of them was not delivered, or was withdrawn, before
 * it could go.
 */
export const outboxDropReasons = [
  "appointmentChanged",
  "noConsent",
  "overtaken",
  "noCareInstructions",
  "answered",
  "replyNotDelivered",
  "replyWithdrawn",
] as const;

export type OutboxDropReason = (typeof outboxDropReasons)[number];

/** The waits after each failed attempt; the attempt after the last one is final. */
const retryDelaysMinutes = [1, 5, 30, 120];

/** How many times a message is tried before it fails for good. */
export const maxOutboxAttempts = retryDelaysMinutes.length + 1;

/** When a message that failed its `attempts`-th try goes again, or `null` when that was its last. */
export function retryAt(attempts: number, now: number): number | null {
  const minutes = retryDelaysMinutes[attempts - 1];
  return minutes === undefined ? null : now + minutes * 60_000;
}
