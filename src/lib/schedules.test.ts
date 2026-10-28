import { describe, expect, it } from "vite-plus/test";

import {
  collisionLabel,
  sameClock,
  scheduleState,
  sharedDates,
  validityLabel,
} from "#/lib/schedules.ts";

// What a schedule's screen offers depends on where today falls in its dates.

const open = { firstDate: "2026-11-02", lastDate: null };

describe("a schedule's state on a given day", () => {
  it("counts a schedule starting today as started, so it can no longer be deleted", () => {
    expect(scheduleState(open, "2026-11-02")).toEqual({
      started: true,
      ended: false,
      changeFrom: "2026-11-02",
      endDefault: "2026-11-02",
    });
  });

  it("changes a future schedule from its own first date", () => {
    expect(scheduleState(open, "2026-10-27")).toMatchObject({
      started: false,
      changeFrom: "2026-11-02",
    });
  });

  it("counts a schedule as ended only after its last day, and ends it there by default", () => {
    const closing = { firstDate: "2026-10-05", lastDate: "2026-10-30" };

    expect(scheduleState(closing, "2026-10-30")).toMatchObject({
      ended: false,
      endDefault: "2026-10-30",
    });
    expect(scheduleState(closing, "2026-10-31")).toMatchObject({ ended: true });
  });
});

describe("a schedule's labels", () => {
  it("tells the dates a schedule applies, open or bounded", () => {
    expect(validityLabel(open)).toBe("Desde el 02/11/2026, sin fecha de fin");
    expect(validityLabel({ firstDate: "2026-10-05", lastDate: "2026-10-30" })).toBe(
      "Desde el 05/10/2026 hasta el 30/10/2026",
    );
  });

  it("tells the schedule a save collides with", () => {
    expect(
      collisionLabel({
        practitionerName: "Lucía Díaz",
        roomName: "Consultorio 1",
        weekday: 3,
        startTime: "09:00",
        endTime: "10:30",
      }),
    ).toBe("Choca con el horario de Lucía Díaz en Consultorio 1, los miércoles de 09:00 a 10:30.");
  });
});

describe("the dates two schedules share", () => {
  it("shares a last and first date in common, and nothing from the day after", () => {
    const ending = { firstDate: "2026-11-02", lastDate: "2026-11-30" };

    expect(sharedDates(ending, { firstDate: "2026-11-30", lastDate: null })).toEqual({
      firstDate: "2026-11-30",
      lastDate: "2026-11-30",
    });
    expect(sharedDates(ending, { firstDate: "2026-12-01", lastDate: null })).toBeNull();
    expect(sharedDates({ firstDate: "2026-12-01", lastDate: null }, ending)).toBeNull();
    expect(sharedDates(open, { firstDate: "2020-01-06", lastDate: null })).toEqual(open);
  });
});

describe("whether two time zones keep the same clock", () => {
  const day = "2026-11-02";
  const nextYear = { firstDate: day, lastDate: null };

  it("matches zones by their clocks, not their names", () => {
    expect(
      sameClock("America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", nextYear, day),
    ).toBe(true);
    expect(sameClock("America/Argentina/Buenos_Aires", "Europe/Madrid", nextYear, day)).toBe(false);
  });

  it("tells apart zones that share a clock only part of the year", () => {
    // Accra keeps London's winter clock all year, but not its summer one.
    expect(sameClock("Europe/London", "Europe/Lisbon", nextYear, day)).toBe(true);
    expect(sameClock("Europe/London", "Africa/Accra", nextYear, day)).toBe(false);
  });

  it("compares the clocks only over the dates given", () => {
    // Santiago keeps Buenos Aires' clock in its summer only.
    const zones = ["America/Santiago", "America/Argentina/Buenos_Aires"] as const;
    const summer = { firstDate: "2026-11-02", lastDate: "2027-03-15" };

    expect(sameClock(...zones, summer, day)).toBe(true);
    expect(sameClock(...zones, nextYear, day)).toBe(false);
  });

  it("compares every week between the ends of a range", () => {
    // Both ends fall in Santiago's summer, its winter in between.
    const yearRound = { firstDate: "2026-11-02", lastDate: "2027-10-04" };

    expect(sameClock("America/Santiago", "America/Argentina/Buenos_Aires", yearRound, day)).toBe(
      false,
    );
  });

  it("compares a far range only through a year past today, up to the last date accepted", () => {
    const zones = ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba"] as const;

    expect(sameClock(...zones, { firstDate: "2026-11-02", lastDate: "9999-12-31" }, day)).toBe(
      true,
    );
    expect(sameClock(...zones, { firstDate: "9999-12-30", lastDate: "9999-12-31" }, day)).toBe(
      true,
    );
    expect(sameClock(...zones, { firstDate: "9999-12-30", lastDate: null }, day)).toBe(true);
  });

  it("compares the clocks from today on, since past dates never collide again", () => {
    // Cordoba kept a clock of its own until 1991, and Moscow left Samara's in October 2014.
    const moscow = ["Europe/Moscow", "Europe/Samara"] as const;
    const sinceYearOne = { firstDate: "0001-01-01", lastDate: null };

    expect(
      sameClock("America/Argentina/Cordoba", "America/Argentina/Buenos_Aires", sinceYearOne, day),
    ).toBe(true);
    expect(sameClock(...moscow, { firstDate: "2012-01-02", lastDate: "2015-01-05" }, day)).toBe(
      true,
    );
    expect(sameClock(...moscow, { firstDate: "2012-01-02", lastDate: null }, day)).toBe(false);
  });

  it("compares a year at most, from today", () => {
    const moscow = ["Europe/Moscow", "Europe/Samara"] as const;

    expect(
      sameClock(...moscow, { firstDate: "2012-01-02", lastDate: "2015-01-05" }, "2012-01-02"),
    ).toBe(true);
  });
});
