import { describe, expect, it } from "vite-plus/test";

import { formatPhone, parsePhone } from "#/lib/phones.ts";

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
