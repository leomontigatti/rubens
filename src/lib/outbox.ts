import type { EventTemplateId } from "#/lib/whatsapp-templates.ts";

// The outbox of messages to patients (docs/domain/messages.md § To staff; ADR-0008
// § Jobs are Durable Object alarms): those of the organization's own templates
// (`src/organization/template-messages.ts`) and of the event templates, the reopen
// one included (`src/organization/late-replies.ts`).

export const outboxKinds = [
  "timed",
  "appointmentMoved",
  "appointmentCancelled",
  "appointmentToReschedule",
  "reopenConversation",
] as const;

export type OutboxKind = (typeof outboxKinds)[number];

export type EventOutboxKind = Exclude<OutboxKind, "timed">;

export const eventKindTemplates = {
  appointmentMoved: "turno_movido",
  appointmentCancelled: "turno_no_disponible",
  appointmentToReschedule: "turno_no_disponible",
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

export const outboxStates = ["queued", "sent", "dropped", "failed"] as const;

/**
 * Why a message was dropped before it went: its appointment changed, its
 * patient withdrew consent, its medical service no longer picks its template
 * (docs/domain/messages.md § When Meta limits the number), or, for the reopen
 * template, the patient wrote first, so the replies it waited for went
 * without it or could not go at all, or the last of them was not delivered,
 * or was withdrawn, before it could go.
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

const retryDelaysMinutes = [1, 5, 30, 120];

export const maxOutboxAttempts = retryDelaysMinutes.length + 1;

export function retryAt(attempts: number, now: number): number | null {
  const minutes = retryDelaysMinutes[attempts - 1];
  return minutes === undefined ? null : now + minutes * 60_000;
}
