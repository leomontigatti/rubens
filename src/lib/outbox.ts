import type { TemplateName } from "#/lib/whatsapp-templates.ts";

// The outbox: every message to a patient is a row queued in the transaction
// that changes the appointment (docs/domain/messages.md § To staff), and the
// organization's alarm sends what is due (ADR-0008 § Jobs are Durable Object
// alarms). It holds the booking confirmation and the reminders.

/** What a queued message is, each sent as its template. */
export const outboxKinds = [
  "bookingConfirmation",
  "reminder",
  "reminderWithoutConfirmation",
] as const;

export type OutboxKind = (typeof outboxKinds)[number];

export const outboxTemplates = {
  bookingConfirmation: "confirmacion_turno",
  reminder: "recordatorio_turno",
  reminderWithoutConfirmation: "recordatorio_turno_sin_confirmacion",
} as const satisfies Record<OutboxKind, TemplateName>;

/** The kinds that are a reminder: one asks the patient to confirm, the other does not. */
export const reminderKinds = [
  "reminder",
  "reminderWithoutConfirmation",
] as const satisfies readonly OutboxKind[];

/** When a reminder set `hoursBefore` an appointment starting at `startsAt` goes. */
export function reminderDueAt(startsAt: number, hoursBefore: number) {
  return startsAt - hoursBefore * 60 * 60_000;
}

/**
 * Where a queued message stands: waiting to go, sent, dropped because it is
 * no longer true or no longer allowed, or failed for good after its retries.
 */
export const outboxStates = ["queued", "sent", "dropped", "failed"] as const;

/**
 * Why a message was dropped before it went: its appointment changed, its
 * patient withdrew consent, or a later reminder for the same appointment was
 * due too (docs/domain/messages.md § When Meta limits the number).
 */
export const outboxDropReasons = ["appointmentChanged", "noConsent", "overtaken"] as const;

/** The waits after each failed attempt; the attempt after the last one is final. */
const retryDelaysMinutes = [1, 5, 30, 120];

/** How many times a message is tried before it fails for good. */
export const maxOutboxAttempts = retryDelaysMinutes.length + 1;

/** When a message that failed its `attempts`-th try goes again, or `null` when that was its last. */
export function retryAt(attempts: number, now: number): number | null {
  const minutes = retryDelaysMinutes[attempts - 1];
  return minutes === undefined ? null : now + minutes * 60_000;
}
