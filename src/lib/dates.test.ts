import { describe, expect, it } from "vite-plus/test";

import {
  formatDate,
  formatDateTime,
  formatDay,
  formatDayHeading,
  formatLocalDate,
  formatMonth,
  formatPromptNow,
  formatTime,
} from "#/lib/dates.ts";

const buenosAires = "America/Argentina/Buenos_Aires";
// 02:30 UTC on 9 November is still 8 November, 23:30, in Buenos Aires.
const lateSunday = new Date("2026-11-09T02:30:00Z");

describe("formatDate", () => {
  it("writes the day the instant falls on in the zone passed, not the process's", () => {
    expect(formatDate(lateSunday, buenosAires)).toBe("08/11/2026");
    expect(formatDate(lateSunday, "UTC")).toBe("09/11/2026");
  });
});

describe("formatTime", () => {
  it("writes a 24-hour clock in the zone passed", () => {
    expect(formatTime(lateSunday, buenosAires)).toBe("23:30");
    expect(formatTime(new Date("2026-11-09T12:05:00Z"), buenosAires)).toBe("09:05");
  });
});

describe("formatDateTime", () => {
  it("writes the date and the 24-hour time in the zone passed", () => {
    expect(formatDateTime(lateSunday, buenosAires)).toBe("08/11/2026 23:30");
  });

  it("takes the epoch milliseconds the stored rows hold", () => {
    expect(formatDateTime(lateSunday.getTime(), "UTC")).toBe("09/11/2026 02:30");
  });
});

describe("formatDay", () => {
  it("writes the weekday and the month in Spanish, in lower case, for running text", () => {
    expect(formatDay(lateSunday, buenosAires)).toBe("domingo 8 de noviembre");
  });
});

describe("formatDayHeading", () => {
  it("starts with a capital, as a heading over the day", () => {
    expect(formatDayHeading(lateSunday, buenosAires)).toBe("Domingo 8 de noviembre");
  });
});

describe("formatLocalDate", () => {
  it("writes a calendar date as day, month and year", () => {
    expect(formatLocalDate("2026-03-07")).toBe("07/03/2026");
  });
});

describe("formatMonth", () => {
  it("names a calendar month in Spanish, with its year", () => {
    expect(formatMonth("2098-12")).toBe("diciembre de 2098");
    expect(formatMonth("2026-01")).toBe("enero de 2026");
  });
});

describe("formatPromptNow", () => {
  it("writes the English weekday and the ISO date and time in the zone passed", () => {
    expect(formatPromptNow(lateSunday, buenosAires)).toBe("Sunday 2026-11-08 23:30");
  });
});
