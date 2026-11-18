import { getCountries, getCountryCallingCode } from "libphonenumber-js";

// The countries a phone field offers, each as staff pick it: its name in
// Spanish, its flag and its dial code.

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2, as `libphonenumber-js` names the country. */
  code: string;
  name: string;
  flag: string;
  /** `+54`. */
  dialCode: string;
}

const names = new Intl.DisplayNames("es", { type: "region" });

const regionalIndicatorA = 0x1f1e6;
const letterA = "A".charCodeAt(0);

const flagOf = (code: string) =>
  String.fromCodePoint(
    ...code.split("").map((letter) => regionalIndicatorA + letter.charCodeAt(0) - letterA),
  );

const byName = new Intl.Collator("es", { sensitivity: "base" });

export const phoneCountries: PhoneCountry[] = getCountries()
  .map((code) => ({
    code,
    name: names.of(code) ?? code,
    flag: flagOf(code),
    dialCode: `+${getCountryCallingCode(code)}`,
  }))
  .sort((one, other) => byName.compare(one.name, other.name));

const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function countryMatches(country: PhoneCountry, query: string): boolean {
  const typed = folded(query.trim());
  if (typed === "") {
    return true;
  }
  if (country.dialCode.startsWith(typed.startsWith("+") ? typed : `+${typed}`)) {
    return true;
  }
  const name = folded(country.name);
  return name.startsWith(typed) || name.split(/[\s-]+/).some((word) => word.startsWith(typed));
}
