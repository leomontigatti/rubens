import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

// Phones are typed in the phone field, a country and its national number, and
// stored in E.164, the format WhatsApp needs (docs/domain/patients.md).

const defaultRegion = "AR";

/** Why a phone field's entry is refused. */
export type PhoneEntryRefusal =
  | "missingPhone"
  | "notDigits"
  | "wrongArgentineNumber"
  | "invalidPhone";

export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: PhoneEntryRefusal };

/**
 * The E.164 phone a search text spells, typed any local way (`0351 15 555-1234`,
 * `3515551234`) or with its `+`; a number with no `+` is read as Argentine.
 * Null when the text is no valid phone.
 */
export function parsePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}

/** A phone as the phone field holds it: a country, and the national number typed for it. */
export interface PhoneEntry {
  country: string;
  number: string;
}

/**
 * Turns a phone field's entry into E.164. An Argentine number is its 10
 * digits, area code without its `0` and number without its `15`, and is
 * stored as a mobile (`+54 9`): 10 digits do not say which it is, and the
 * phone is where WhatsApp messages go, which reach only a mobile.
 */
export function parsePhoneEntry(entry: PhoneEntry): PhoneResult {
  const { number } = entry;
  if (number.trim() === "") {
    return { ok: false, reason: "missingPhone" };
  }
  if (!/^\d+$/.test(number)) {
    return { ok: false, reason: "notDigits" };
  }
  if (entry.country === defaultRegion) {
    return argentineNumber.test(number)
      ? { ok: true, phone: `+549${number}` }
      : { ok: false, reason: "wrongArgentineNumber" };
  }
  const { country } = entry;
  if (!isSupportedCountry(country)) {
    return { ok: false, reason: "invalidPhone" };
  }
  const parsed = parsePhoneNumberFromString(number, country);
  // The country's own dial code: a number typed with an exit code, such as
  // `0034…` under Germany, reads as the country it dials, not the one picked.
  return parsed?.isValid() && parsed.countryCallingCode === getCountryCallingCode(country)
    ? { ok: true, phone: parsed.number }
    : { ok: false, reason: "invalidPhone" };
}

/** What an empty phone field holds: Argentina, and no number yet. */
export const emptyPhoneEntry: PhoneEntry = { country: defaultRegion, number: "" };

/**
 * A stored E.164 phone as its phone field shows it again: its country, and
 * the national number, an Argentine one without the `9` of a mobile.
 */
export function splitPhone(phone: string): PhoneEntry {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed?.country) {
    return { country: defaultRegion, number: phone.replace(/\D/g, "") };
  }
  const national = parsed.nationalNumber;
  const number =
    parsed.country === defaultRegion ? national.replace(/^9(?=\d{10}$)/, "") : national;
  return { country: parsed.country, number };
}

/** An area code without its `0` (`11`, or starting with 2 or 3) and the number, 10 digits in all. */
const argentineNumber = /^(?:11\d{8}|[23]\d{9})$/;

/**
 * An E.164 phone as people read it: an Argentine number as the 10 digits its
 * phone field takes, spaced the local way with no `0` and no `15`; any other
 * with its country prefix.
 */
export function formatPhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone);
  if (parsed?.country !== defaultRegion) {
    return parsed ? parsed.formatInternational() : phone;
  }
  const digits = splitPhone(phone).number;
  const landline = parsePhoneNumberFromString(`+54${digits}`);
  return landline ? landline.formatNational().replace(/^0/, "") : digits;
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

/** An E.164 phone with all but its last four digits hidden, for a record that must not hold it. */
export function maskPhone(phone: string): string {
  const shown = phone.slice(-4);
  return phone.slice(0, -4).replace(/\d/g, "•") + shown;
}
