import { describe, expect, it } from "vite-plus/test";

import { formatPhone, parsePhone, parsePhoneEntry, splitPhone } from "#/lib/phones.ts";

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
    expect(parsePhone(input)).toEqual({ ok: true, phone });
  });

  it("keeps a foreign number typed with its country prefix", () => {
    expect(parsePhone("+34 612 345 678")).toEqual({ ok: true, phone: "+34612345678" });
  });

  it.each(["15 555-1234", "555-1234", "4555123"])(
    "refuses %s, a local number with no area code",
    (input) => {
      expect(parsePhone(input)).toEqual({ ok: false, reason: "missingAreaCode" });
    },
  );

  it.each(["12", "0351 12", "abc", "", "+34 12", "0351 15 555-1234-9999"])(
    "refuses %s, which cannot be a valid number",
    (input) => {
      expect(parsePhone(input)).toEqual({ ok: false, reason: "invalidPhone" });
    },
  );
});

describe("formatPhone", () => {
  it("shows an Argentine mobile the local way, with its area code and 15", () => {
    expect(formatPhone("+5493515551234")).toBe("0351 15-555-1234");
  });

  it("shows an Argentine landline the local way", () => {
    expect(formatPhone("+541155551234")).toBe("011 5555-1234");
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
    ["DE", "0034612345678"],
  ])("refuses a number of %s that cannot be valid there: %s", (country, number) => {
    expect(parsePhoneEntry({ country, number })).toEqual({ ok: false, reason: "invalidPhone" });
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

  it.each(["+5493515551234", "+34612345678", "+12025550123"])(
    "gives back %s when the split is saved unchanged",
    (phone) => {
      expect(parsePhoneEntry(splitPhone(phone))).toEqual({ ok: true, phone });
    },
  );
});
