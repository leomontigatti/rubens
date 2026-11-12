import { describe, expect, it } from "vite-plus/test";

import { dateText, shownText, timeText, typedValue } from "#/components/date-time-text.ts";

/** The box's text after typing `keys` one at a time, as the box masks each. */
const typedKeys = (kind: typeof dateText, keys: string) =>
  [...keys].reduce((text, key) => kind.mask(text + key), "");

describe("a typed date", () => {
  it("is held as the calendar date it names, day first", () => {
    expect(typedValue(dateText, "07/03/2026")).toBe("2026-03-07");
  });

  it("takes a one-digit day or month", () => {
    expect(typedValue(dateText, "7/3/2026")).toBe("2026-03-07");
  });

  it("is held as typed when it names no day, so the form refuses it rather than dropping it", () => {
    expect(typedValue(dateText, "31/02/2026")).toBe("31/02/2026");
    expect(typedValue(dateText, "07/13/2026")).toBe("07/13/2026");
    expect(typedValue(dateText, "07/03")).toBe("07/03");
  });

  it("is empty when nothing is typed", () => {
    expect(typedValue(dateText, "")).toBe("");
  });

  it("gets its slashes from digits alone, as a phone's numeric keyboard types them", () => {
    expect(dateText.mask("0703")).toBe("07/03");
    expect(dateText.mask("07032026")).toBe("07/03/2026");
    expect(dateText.mask("070")).toBe("07/0");
    expect(dateText.mask("07")).toBe("07");
  });

  it("keeps every digit typed one at a time after the slash it put in", () => {
    expect(typedKeys(dateText, "20112026")).toBe("20/11/2026");
    expect(typedKeys(dateText, "8/3/2026")).toBe("8/3/2026");
  });

  it("keeps the slashes typed, and drops what is not a digit or one", () => {
    expect(dateText.mask("7/3/2026")).toBe("7/3/2026");
    expect(dateText.mask("7-3")).toBe("73");
    expect(dateText.mask("07/03/20261")).toBe("07/03/2026");
  });
});

describe("a typed time", () => {
  it("is held on a 24-hour clock, with two digits for the hour", () => {
    expect(typedValue(timeText, "19:30")).toBe("19:30");
    expect(typedValue(timeText, "9:05")).toBe("09:05");
  });

  it("is held as typed when it is no time of day", () => {
    expect(typedValue(timeText, "24:00")).toBe("24:00");
    expect(typedValue(timeText, "9:60")).toBe("9:60");
    expect(typedValue(timeText, "930")).toBe("930");
  });

  it("keeps every digit typed one at a time after the colon it put in", () => {
    expect(typedKeys(timeText, "1330")).toBe("13:30");
  });

  it("gets its colon from digits alone", () => {
    expect(timeText.mask("1930")).toBe("19:30");
    expect(timeText.mask("193")).toBe("19:3");
    expect(timeText.mask("19")).toBe("19");
    expect(timeText.mask("9:3")).toBe("9:3");
    expect(timeText.mask("19:305")).toBe("19:30");
  });
});

describe("the text a field shows", () => {
  it("is what is being typed while it still stands for the form's value", () => {
    expect(shownText(dateText, "7/3/2026", "2026-03-07")).toBe("7/3/2026");
    expect(shownText(dateText, "07/0", "07/0")).toBe("07/0");
  });

  it("is the form's value, written, once that value changes elsewhere", () => {
    expect(shownText(dateText, "7/3/2026", "2026-12-25")).toBe("25/12/2026");
    expect(shownText(timeText, "9:05", "")).toBe("");
  });

  it("is the value written out when nothing is being typed", () => {
    expect(shownText(dateText, null, "2026-03-07")).toBe("07/03/2026");
    expect(shownText(timeText, null, "09:05")).toBe("09:05");
    expect(shownText(dateText, null, "31/02/2026")).toBe("31/02/2026");
  });
});
