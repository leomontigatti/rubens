import { parsePhoneNumberFromString } from "libphonenumber-js";

// Phones are typed the local way and stored in E.164, the format WhatsApp
// needs (docs/domain/patients.md). A number with no `+` is read as Argentine.

const defaultRegion = "AR";

export type PhoneRefusal = "missingAreaCode" | "invalidPhone";

export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: PhoneRefusal };

/**
 * Whether `input` reads as an Argentine local number typed without its area
 * code: 6 to 8 digits, after an optional `15`, and no leading `0` (which
 * starts an area code). Such a number could belong to any area, so it is
 * refused rather than guessed.
 */
function lacksAreaCode(input: string): boolean {
  if (input.trim().startsWith("+")) {
    return false;
  }
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    return false;
  }
  const subscriber = digits.startsWith("15") ? digits.slice(2) : digits;
  return subscriber.length >= 6 && subscriber.length <= 8;
}

/** Turns a typed phone into E.164, or says why it cannot. */
export function parsePhone(input: string): PhoneResult {
  const parsed = parsePhoneNumberFromString(input, defaultRegion);
  if (parsed?.isValid()) {
    return { ok: true, phone: parsed.number };
  }
  if (lacksAreaCode(input)) {
    return { ok: false, reason: "missingAreaCode" };
  }
  return { ok: false, reason: "invalidPhone" };
}

/** An E.164 phone as staff read and dial it: Argentine numbers the local way. */
export function formatPhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed) {
    return phone;
  }
  return parsed.country === defaultRegion ? parsed.formatNational() : parsed.formatInternational();
}

/**
 * The E.164 spellings of one number. An Argentine mobile is `+54 9 …` when
 * typed with its `15` and `+54 …` without it (a landline shares the same
 * national numbers, so the two never name different lines), while WhatsApp
 * always sends a mobile with the `9`.
 */
export function phoneSpellings(phone: string): string[] {
  const argentine = /^\+54(9?)(\d+)$/.exec(phone);
  if (!argentine) {
    return [phone];
  }
  const [, mobile, national] = argentine;
  return mobile ? [phone, `+54${national}`] : [phone, `+549${national}`];
}
