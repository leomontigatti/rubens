// The customer service window (docs/domain/assistant.md § The conversation window).

export const conversationWindowMs = 24 * 60 * 60_000;

/** `null` when the patient never wrote, so the window never opened. */
export function windowClosesAt(lastIncomingSentAt: number | null): number | null {
  return lastIncomingSentAt === null ? null : lastIncomingSentAt + conversationWindowMs;
}

export function isWindowOpen(lastIncomingSentAt: number | null, now: number): boolean {
  const closesAt = windowClosesAt(lastIncomingSentAt);
  return closesAt !== null && now < closesAt;
}
