import { describe, expect, it } from "vite-plus/test";

import { findFreeStarts, freeStartsByDay } from "#/lib/availability.ts";
import type { AvailabilityInput, AvailabilitySchedule } from "#/lib/availability.ts";

// Buenos Aires is UTC-3 all year, so 09:00 there is 12:00Z. 2099-01-05 is a Monday.

const buenosAires = "America/Argentina/Buenos_Aires";

const morning: AvailabilitySchedule = {
  officeId: "office-centro",
  roomId: "room-1",
  timeZone: buenosAires,
  weekdays: [1],
  startTime: "09:00",
  endTime: "10:00",
  firstDate: "2099-01-05",
  lastDate: null,
};

function input(overrides: Partial<AvailabilityInput>): AvailabilityInput {
  return {
    schedules: [morning],
    timeOff: [],
    closures: [],
    busy: [],
    gridMinutes: 15,
    window: { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-06T03:00:00Z") },
    durationMinutes: 15,
    ...overrides,
  };
}

/** The free starts as ISO instants, for compact assertions. */
function starts(overrides: Partial<AvailabilityInput>): string[] {
  return findFreeStarts(input(overrides)).map((free) => free.start.toISOString());
}

describe("the grid", () => {
  it("offers every 15 minutes of a schedule by default, with its office and room", () => {
    expect(findFreeStarts(input({}))).toEqual([
      { start: new Date("2099-01-05T12:00:00Z"), officeId: "office-centro", roomId: "room-1" },
      { start: new Date("2099-01-05T12:15:00Z"), officeId: "office-centro", roomId: "room-1" },
      { start: new Date("2099-01-05T12:30:00Z"), officeId: "office-centro", roomId: "room-1" },
      { start: new Date("2099-01-05T12:45:00Z"), officeId: "office-centro", roomId: "room-1" },
    ]);
  });

  it("respects a custom grid counted from local midnight", () => {
    expect(starts({ gridMinutes: 20 })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:20:00.000Z",
      "2099-01-05T12:40:00.000Z",
    ]);
  });

  it("offers the first grid point inside a schedule that starts off the grid", () => {
    const offGrid = { ...morning, startTime: "09:10" };

    expect(starts({ schedules: [offGrid] })).toEqual([
      "2099-01-05T12:15:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T12:45:00.000Z",
    ]);
  });
});

describe("the duration", () => {
  it("offers a start only when the whole duration fits before the schedule ends", () => {
    expect(starts({ durationMinutes: 40 })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:15:00.000Z",
    ]);
  });

  it("never spans the break between two schedules", () => {
    const afternoon = { ...morning, startTime: "10:30", endTime: "11:00" };

    expect(starts({ schedules: [morning, afternoon], durationMinutes: 30 })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:15:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T13:30:00.000Z",
    ]);
  });

  it("does not join two schedules that touch end to end", () => {
    const next = { ...morning, startTime: "10:00", endTime: "11:00", roomId: "room-2" };

    expect(starts({ schedules: [morning, next], durationMinutes: 60 })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T13:00:00.000Z",
    ]);
  });
});

describe("the schedule's dates", () => {
  const week = { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-26T03:00:00Z") };

  it("offers only weekdays between the first and the last date", () => {
    const bounded = { ...morning, firstDate: "2099-01-06", lastDate: "2099-01-19" };

    expect(starts({ schedules: [bounded], window: week, durationMinutes: 60 })).toEqual([
      "2099-01-12T12:00:00.000Z",
      "2099-01-19T12:00:00.000Z",
    ]);
  });

  it("offers each weekday a schedule names", () => {
    const twice = { ...morning, weekdays: [1, 3] };
    const days = { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-12T03:00:00Z") };

    expect(starts({ schedules: [twice], window: days, durationMinutes: 60 })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-07T12:00:00.000Z",
    ]);
  });
});

describe("time off, closures and busy ranges", () => {
  it("skips a whole day of time off", () => {
    const day = { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-06T03:00:00Z") };

    expect(starts({ timeOff: [day] })).toEqual([]);
  });

  it("skips the starts whose span meets partial-day time off", () => {
    const away = { start: new Date("2099-01-05T12:30:00Z"), end: new Date("2099-01-05T12:45:00Z") };

    expect(starts({ timeOff: [away], durationMinutes: 30 })).toEqual(["2099-01-05T12:00:00.000Z"]);
  });

  it("skips closures, whether of an office or the organization", () => {
    const officeClosed = {
      start: new Date("2099-01-05T12:00:00Z"),
      end: new Date("2099-01-05T12:15:00Z"),
    };
    const organizationClosed = {
      start: new Date("2099-01-05T12:45:00Z"),
      end: new Date("2099-01-05T15:00:00Z"),
    };

    expect(starts({ closures: [officeClosed, organizationClosed] })).toEqual([
      "2099-01-05T12:15:00.000Z",
      "2099-01-05T12:30:00.000Z",
    ]);
  });

  it("skips busy ranges, and a range that only touches the span leaves it free", () => {
    const booked = {
      start: new Date("2099-01-05T12:15:00Z"),
      end: new Date("2099-01-05T12:30:00Z"),
    };

    expect(starts({ busy: [booked] })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T12:45:00.000Z",
    ]);
  });
});

describe("the window", () => {
  it("covers several days and crosses midnight in the office's zone", () => {
    const evening = { ...morning, weekdays: [1, 2], startTime: "23:00", endTime: "23:30" };
    const twoDays = {
      start: new Date("2099-01-05T15:00:00Z"),
      end: new Date("2099-01-07T02:20:00Z"),
    };

    expect(starts({ schedules: [evening], window: twoDays })).toEqual([
      "2099-01-06T02:00:00.000Z",
      "2099-01-06T02:15:00.000Z",
      "2099-01-07T02:00:00.000Z",
      "2099-01-07T02:15:00.000Z",
    ]);
  });

  it("offers only starts inside the window", () => {
    const partial = {
      start: new Date("2099-01-05T12:20:00Z"),
      end: new Date("2099-01-05T12:45:00Z"),
    };

    expect(starts({ window: partial })).toEqual(["2099-01-05T12:30:00.000Z"]);
  });
});

describe("offices", () => {
  it("reads each schedule in its own office's zone, in start order", () => {
    const madrid = {
      ...morning,
      officeId: "office-madrid",
      roomId: "room-m",
      timeZone: "Europe/Madrid",
      startTime: "09:00",
      endTime: "09:30",
    };

    expect(findFreeStarts(input({ schedules: [morning, madrid], durationMinutes: 30 }))).toEqual([
      { start: new Date("2099-01-05T08:00:00Z"), officeId: "office-madrid", roomId: "room-m" },
      { start: new Date("2099-01-05T12:00:00Z"), officeId: "office-centro", roomId: "room-1" },
      { start: new Date("2099-01-05T12:15:00Z"), officeId: "office-centro", roomId: "room-1" },
      { start: new Date("2099-01-05T12:30:00Z"), officeId: "office-centro", roomId: "room-1" },
    ]);
  });

  it("gives the same starts whatever the process's time zone", () => {
    const original = process.env.TZ;
    try {
      const results = ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map((zone) => {
        process.env.TZ = zone;
        return starts({});
      });

      expect(results).toEqual([results[0], results[0], results[0]]);
      expect(results[0]).toEqual([
        "2099-01-05T12:00:00.000Z",
        "2099-01-05T12:15:00.000Z",
        "2099-01-05T12:30:00.000Z",
        "2099-01-05T12:45:00.000Z",
      ]);
    } finally {
      if (original === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = original;
      }
    }
  });
});

describe("free starts by day", () => {
  it("groups starts under their local date in their office's zone, with local times", () => {
    const at = (iso: string, timeZone = buenosAires) => ({
      start: new Date(iso),
      timeZone,
      officeName: "Sede Centro",
      roomName: "Consultorio 1",
    });

    expect(
      freeStartsByDay([
        at("2099-01-06T02:30:00Z"),
        at("2099-01-06T08:00:00Z", "Europe/Madrid"),
        at("2099-01-06T12:00:00Z"),
      ]),
    ).toEqual([
      {
        date: "2099-01-05",
        label: "Lunes 05/01/2099",
        starts: [
          expect.objectContaining({ time: "23:30", start: new Date("2099-01-06T02:30:00Z") }),
        ],
      },
      {
        date: "2099-01-06",
        label: "Martes 06/01/2099",
        starts: [
          expect.objectContaining({ time: "09:00", start: new Date("2099-01-06T08:00:00Z") }),
          expect.objectContaining({ time: "09:00", start: new Date("2099-01-06T12:00:00Z") }),
        ],
      },
    ]);
  });
});
