// What Meta's Embedded Signup v4 popup tells the page (ADR-0010 § A new
// number, owned by the practice). The popup posts a `WA_EMBEDDED_SIGNUP`
// message to the window when the admin finishes, cancels or hits an error;
// the code to exchange comes separately, through `FB.login`'s callback. Only
// a message from Facebook's own origin counts: any page could post one.

import type { SignupCompletion } from "#/lib/whatsapp.ts";

export type SignupEvent =
  | { kind: "finished"; phoneNumberId: string; businessAccountId: string }
  | { kind: "cancelled" }
  /** Meta's message, or `null` when the signup ended without a number to connect. */
  | { kind: "failed"; message: string | null };

function isFacebook(origin: string) {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" && (hostname === "facebook.com" || hostname.endsWith(".facebook.com"))
    );
  } catch {
    // Not a URL, such as `null` from a sandboxed frame: not Facebook.
    return false;
  }
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

/** The signup's event in a window message, or `null` for any other message. */
export function signupEventOf(origin: string, data: unknown): SignupEvent | null {
  if (!isFacebook(origin) || typeof data !== "string") {
    return null;
  }
  let message: { type?: unknown; event?: unknown; data?: Record<string, unknown> };
  try {
    message = JSON.parse(data) as typeof message;
  } catch {
    // Facebook's SDK posts other messages, not all of them JSON.
    return null;
  }
  if (message?.type !== "WA_EMBEDDED_SIGNUP") {
    return null;
  }
  const details = message.data ?? {};
  if (message.event === "CANCEL") {
    return { kind: "cancelled" };
  }
  if (message.event === "ERROR") {
    return { kind: "failed", message: text(details.error_message) };
  }
  const phoneNumberId = text(details.phone_number_id);
  const businessAccountId = text(details.waba_id);
  if (message.event === "FINISH" && phoneNumberId && businessAccountId) {
    return { kind: "finished", phoneNumberId, businessAccountId };
  }
  return { kind: "failed", message: null };
}

export type SignupOutcome =
  | { kind: "completed"; completion: SignupCompletion }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string | null };

/**
 * How the signup ended, once `FB.login` answered with `code` (`null` when the
 * admin closed the popup): completed only with both the code and the number
 * from the popup's message, or `null` while that message is still to come.
 */
export function signupOutcomeOf(
  code: string | null,
  event: SignupEvent | null,
): SignupOutcome | null {
  if (event?.kind === "failed") {
    return event;
  }
  if (!code || event?.kind === "cancelled") {
    return { kind: "cancelled" };
  }
  if (event?.kind === "finished") {
    const { phoneNumberId, businessAccountId } = event;
    return { kind: "completed", completion: { code, phoneNumberId, businessAccountId } };
  }
  return null;
}
