import { describe, expect, it } from "vite-plus/test";

import { textFieldSize } from "#/components/field-size.ts";

describe("textFieldSize", () => {
  it("keeps a number or a time small, three to a row", () => {
    expect(textFieldSize("number")).toBe("small");
    expect(textFieldSize("time")).toBe("small");
  });

  it("gives a text, a date or a date and time half the row", () => {
    expect(textFieldSize(undefined)).toBe("medium");
    expect(textFieldSize("email")).toBe("medium");
    expect(textFieldSize("date")).toBe("medium");
    expect(textFieldSize("datetime-local")).toBe("medium");
  });
});
