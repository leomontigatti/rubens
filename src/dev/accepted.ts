/** `result` when the object accepted a seed step; a refusal stops the seed. */
export function accepted<T extends { ok: true } | { ok: false; reason: string }>(
  step: string,
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`dev seed: ${step} refused (${result.reason})`);
  }
  return result as Extract<T, { ok: true }>;
}
