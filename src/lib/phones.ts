import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

// Phones are typed in the phone field, a country and its national number, and
// stored in E.164, the format WhatsApp needs (docs/domain/patients.md).

const defaultRegion = "AR";

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

export interface PhoneEntry {
  country: string;
  number: string;
}

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
  return parsed?.isValid() &&
    parsed.countryCallingCode === getCountryCallingCode(country) &&
    parsePhoneNumberFromString(parsed.number)?.isValid()
    ? { ok: true, phone: parsed.number }
    : { ok: false, reason: "invalidPhone" };
}

export const emptyPhoneEntry: PhoneEntry = { country: defaultRegion, number: "" };

/**
 * A stored E.164 phone as its phone field shows it again: its country, and
 * the national number, an Argentine one without the `9` of a mobile.
 */
export function splitPhone(phone: string): PhoneEntry {
  const parsed = parsePhoneNumberFromString(phone);
  const country = parsed?.country ?? parsed?.getPossibleCountries()[0];
  if (!parsed || !country) {
    return { country: defaultRegion, number: phone.replace(/\D/g, "") };
  }
  const national = parsed.nationalNumber;
  const number = country === defaultRegion ? national.replace(/^9(?=\d{10}$)/, "") : national;
  return { country, number };
}

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
