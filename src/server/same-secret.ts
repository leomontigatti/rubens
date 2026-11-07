import { timingSafeEqual } from "node:crypto";

/** Whether `given` is `expected`, compared in constant time. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}
