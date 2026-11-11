import type { EventTemplateId } from "#/lib/whatsapp-templates.ts";

// The outbox: every message to a patient is a row queued in the transaction
// that changes the appointment (docs/domain/messages.md § To staff), and the
// organization's alarm sends what is due (ADR-0008 § Jobs are Durable Object
// alarms). It holds the messages of the organization's own templates, each at
// its timing (`src/organization/template-messages.ts`), and those of the event
// templates: for an appointment the organization changed, and the reopen
// template, about a conversation rather than an appointment, for a person's
// reply written after its window closed (`src/organization/late-replies.ts`).

/** What a queued message is: one of the organization's own templates, or an event's. */
export const outboxKinds = [
  "timed",
  "appointmentMoved",
  "appointmentCancelled",
  "appointmentToReschedule",
  "reopenConversation",
] as const;

export type OutboxKind = (typeof outboxKinds)[number];

export type EventOutboxKind = Exclude<OutboxKind, "timed">;

/** The event template each event's message goes as. */
export const eventKindTemplates = {
  appointmentMoved: "turno_movido",
  appointmentCancelled: "turno_cancelado",
  appointmentToReschedule: "turno_a_reprogramar",
  reopenConversation: "reabrir_conversacion",
} as const satisfies Record<EventOutboxKind, EventTemplateId>;

/**
 * The kinds that tell the patient the organization changed their appointment:
 * only the one for its latest change goes.
 */
export const changeKinds = [
  "appointmentMoved",
  "appointmentCancelled",
  "appointmentToReschedule",
] as const satisfies readonly OutboxKind[];

/**
 * Where a queued message stands: waiting to go, sent, dropped because it is
 * no longer true or no longer allowed, or failed for good after its retries.
 */
export const outboxStates = ["queued", "sent", "dropped", "failed"] as const;

/**
 * Why a message was dropped before it went: its appointment changed, its
 * patient withdrew consent, its medical service no longer picks its template
 * (docs/domain/messages.md § When Meta limits the number), or, for the reopen
 * template, the patient wrote first, so the replies it waited for went
 * without it, or the last of them was not delivered, or was withdrawn, before
 * it could go.
 */
export const outboxDropReasons = [
  "appointmentChanged",
  "noConsent",
  "templateUnpicked",
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
