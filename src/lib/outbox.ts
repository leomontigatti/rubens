import type { TemplateName } from "#/lib/whatsapp-templates.ts";

// The outbox: every message to a patient is a row queued in the transaction
// that changes the appointment (docs/domain/messages.md § To staff), and the
// organization's alarm sends what is due (ADR-0008 § Jobs are Durable Object
// alarms). For now it holds the booking confirmation only.

/** What a queued message is, each sent as its template. */
export const outboxKinds = ["bookingConfirmation"] as const;

export type OutboxKind = (typeof outboxKinds)[number];

export const outboxTemplates = {
  bookingConfirmation: "confirmacion_turno",
} as const satisfies Record<OutboxKind, TemplateName>;

/**
 * Where a queued message stands: waiting to go, sent, dropped because it is
 * no longer true or no longer allowed, or failed for good after its retries.
 */
export const outboxStates = ["queued", "sent", "dropped", "failed"] as const;

/** Why a message was dropped before it went. */
export const outboxDropReasons = ["appointmentChanged", "noConsent"] as const;

/** The waits after each failed attempt; the attempt after the last one is final. */
const retryDelaysMinutes = [1, 5, 30, 120];

/** How many times a message is tried before it fails for good. */
export const maxOutboxAttempts = retryDelaysMinutes.length + 1;

/** When a message that failed its `attempts`-th try goes again, or `null` when that was its last. */
export function retryAt(attempts: number, now: number): number | null {
  const minutes = retryDelaysMinutes[attempts - 1];
  return minutes === undefined ? null : now + minutes * 60_000;
}
