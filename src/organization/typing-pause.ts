// The pause the assistant types for before each message it sends
// (docs/domain/assistant.md § Pace), alone in its module so the object's
// tests (`typing-pause.test-support.ts`) record it instead of waiting.

/** Waits `ms` milliseconds while the patient sees the assistant typing. */
export function typingPause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
