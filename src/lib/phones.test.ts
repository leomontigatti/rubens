import fc from "fast-check";
import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js";
import { describe, expect, it } from "vite-plus/test";

import {
  formatPhone,
  parsePhone,
  parsePhoneEntry,
  phoneSpellings,
  splitPhone,
} from "#/lib/phones.ts";

describe("parsePhone", () => {
  it.each([
    ["0351 15 555-1234", "+5493515551234"],
    ["351 15 5551234", "+5493515551234"],
    ["0351-155551234", "+5493515551234"],
    ["351 5551234", "+543515551234"],
    ["0351 455-5123", "+543514555123"],
    ["011 15 5555-1234", "+5491155551234"],
    ["11 5555 1234", "+541155551234"],
    ["+54 9 351 555 1234", "+5493515551234"],
    ["+5493515551234", "+5493515551234"],
  ])("reads the Argentine number %s as %s", (input, phone) => {
    expect(parsePhone(input)).toBe(phone);
  });

  it("keeps a foreign number typed with its country prefix", () => {
    expect(parsePhone("+34 612 345 678")).toBe("+34612345678");
  });

  it.each([
    "15 555-1234",
    "555-1234",
    "12",
    "0351 12",
    "abc",
    "",
    "+34 12",
    "0351 15 555-1234-9999",
  ])("reads %s as no phone", (input) => {
    expect(parsePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it.each([
    ["+5493515551234", "351 555-1234"],
    ["+543515551234", "351 555-1234"],
    ["+5491155551234", "11 5555-1234"],
  ])("shows the Argentine number %s as its 10 digits, without a 0 or a 15", (phone, shown) => {
    expect(formatPhone(phone)).toBe(shown);
  });

  it("shows a foreign number with its country prefix", () => {
    expect(formatPhone("+34612345678")).toBe("+34 612 34 56 78");
  });
});

describe("parsePhoneEntry", () => {
  it("reads 10 Argentine digits as a mobile, the spelling WhatsApp sends to", () => {
    expect(parsePhoneEntry({ country: "AR", number: "3515551234" })).toEqual({
      ok: true,
      phone: "+5493515551234",
    });
  });

  it.each(["351 555 1234", "351-5551234", "+543515551234", " 3515551234 "])(
    "refuses %s, which holds more than digits",
    (number) => {
      expect(parsePhoneEntry({ country: "AR", number })).toEqual({
        ok: false,
        reason: "notDigits",
      });
    },
  );

  it.each([
    ["351555123", "too short"],
    ["351155551234", "typed with its 15"],
    ["0351555123", "typed with the 0 of its area code"],
    ["1555512345", "a 15 with no area code"],
  ])("refuses the Argentine number %s, %s", (number) => {
    expect(parsePhoneEntry({ country: "AR", number })).toEqual({
      ok: false,
      reason: "wrongArgentineNumber",
    });
  });

  it("refuses an empty number as missing, not as wrong", () => {
    expect(parsePhoneEntry({ country: "AR", number: " " })).toEqual({
      ok: false,
      reason: "missingPhone",
    });
  });

  it("reads another country's national number with that country's prefix", () => {
    expect(parsePhoneEntry({ country: "ES", number: "612345678" })).toEqual({
      ok: true,
      phone: "+34612345678",
    });
  });

  it.each([
    ["ES", "12"],
    ["XX", "612345678"],
    ["IM", "7676066122"],
    ["BY", "08142331369"],
  ])("refuses a number of %s that cannot be valid there: %s", (country, number) => {
    expect(parsePhoneEntry({ country, number })).toEqual({ ok: false, reason: "invalidPhone" });
  });

  it("refuses a number typed with an exit code that dials another country than the one picked", () => {
    expect(parsePhoneEntry({ country: "DE", number: "0034612345678" })).toEqual({
      ok: false,
      reason: "invalidPhone",
    });
  });
});

describe("splitPhone", () => {
  it.each([
    ["+5493515551234", { country: "AR", number: "3515551234" }],
    ["+543515551234", { country: "AR", number: "3515551234" }],
    ["+541155551234", { country: "AR", number: "1155551234" }],
    ["+34612345678", { country: "ES", number: "612345678" }],
  ])("splits %s into what the phone field shows", (phone, entry) => {
    expect(splitPhone(phone)).toEqual(entry);
  });

  it("opens an empty phone, a new guardian's, on Argentina with no number", () => {
    expect(splitPhone("")).toEqual({ country: "AR", number: "" });
  });

  it.each(["+5493515551234", "+34612345678", "+12025550123", "+35811323", "+358990900"])(
    "gives back %s when the split is saved unchanged",
    (phone) => {
      expect(parsePhoneEntry(splitPhone(phone))).toEqual({ ok: true, phone });
    },
  );
});

describe("phone round trips", () => {
  const digits = fc.string({
    unit: fc.constantFrom(..."0123456789".split("")),
    minLength: 4,
    maxLength: 13,
  });

  const savedPhone = fc
    .record({ country: fc.constantFrom(...getCountries()), number: digits })
    .map(parsePhoneEntry)
    .filter((result) => result.ok)
    .map((result) => (result.ok ? result.phone : ""));

  const argentinePhone = fc
    .tuple(
      fc.constantFrom("+54", "+549"),
      fc.oneof(
        digits.map((rest) => `11${rest}`.padEnd(10, "0").slice(0, 10)),
        fc
          .tuple(fc.constantFrom("2", "3"), digits)
          .map(([area, rest]) => `${area}${rest}`.padEnd(10, "0").slice(0, 10)),
      ),
    )
    .map(([prefix, national]) => `${prefix}${national}`)
    .filter((phone) => parsePhoneNumberFromString(phone)?.isValid() === true);

  // Catches a number valid only for the country picked, whose E.164 then reopens
  // as Argentine digits, and a split that keeps or drops the wrong mobile 9.
  it("reopens any phone the field saved and saves it back unchanged", () => {
    fc.assert(
      fc.property(savedPhone, (phone) => {
        expect(parsePhoneEntry(splitPhone(phone))).toEqual({ ok: true, phone });
      }),
      { numRuns: 1000 },
    );
  });

  // Catches a shown number that search reads as some other phone: the mobile's
  // 9 or the area code lost between formatting and parsing.
  it("finds an Argentine phone when searched as it is shown", () => {
    fc.assert(
      fc.property(argentinePhone, (phone) => {
        const searched = parsePhone(formatPhone(phone));
        expect(searched === null ? [] : phoneSpellings(searched)).toContain(phone);
      }),
    );
  });

  // Catches a spelling list that swaps the phone for its other spelling, which
  // would hide a conversation stored as typed.
  it("spells every phone at least as itself", () => {
    fc.assert(
      fc.property(fc.oneof(savedPhone, argentinePhone, fc.string()), (phone) => {
        expect(phoneSpellings(phone)).toContain(phone);
      }),
    );
  });
});
