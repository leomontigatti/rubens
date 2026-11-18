// The customer service window (docs/domain/assistant.md § The conversation window).

export const conversationWindowMs = 24 * 60 * 60_000;

/**
 * When the window of a conversation whose patient last wrote at
 * `lastIncomingAt` closes, by Meta's time for that message; `null` when the
 * patient never wrote, so it never opened.
 */
export function windowClosesAt(lastIncomingAt: number | null): number | null {
  return lastIncomingAt === null ? null : lastIncomingAt + conversationWindowMs;
}

export function isWindowOpen(lastIncomingAt: number | null, now: number): boolean {
  const closesAt = windowClosesAt(lastIncomingAt);
  return closesAt !== null && now < closesAt;
}
