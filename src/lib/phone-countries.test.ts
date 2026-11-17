import { describe, expect, it } from "vite-plus/test";

import { countryMatches, phoneCountries } from "#/lib/phone-countries.ts";

describe("phoneCountries", () => {
  it("names a country in Spanish, with its flag and dial code", () => {
    expect(phoneCountries.find((country) => country.code === "US")).toEqual({
      code: "US",
      name: "Estados Unidos",
      flag: "🇺🇸",
      dialCode: "+1",
    });
  });

  it("lists the countries by name as a Spanish reader orders them, accents aside", () => {
    const names = phoneCountries.map((country) => country.name);
    expect(names.indexOf("Bélgica")).toBeLessThan(names.indexOf("Belice"));
  });
});

describe("countryMatches", () => {
  const country = (code: string) => phoneCountries.find((one) => one.code === code)!;

  it("finds a country by the start of a word of its name, accents and case aside", () => {
    expect(countryMatches(country("JP"), "japon")).toBe(true);
    expect(countryMatches(country("US"), "Unidos")).toBe(true);
  });

  it("does not find a country whose name only holds the text inside a word", () => {
    expect(countryMatches(country("UY"), "uru")).toBe(true);
    expect(countryMatches(country("BI"), "uru")).toBe(false);
  });

  it.each(["54", "+54"])("finds a country by its dial code typed as %s", (query) => {
    expect(countryMatches(country("AR"), query)).toBe(true);
  });
});
