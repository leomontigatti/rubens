import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  availabilityQuerySchema,
  availabilitySearchProblem,
  availabilityViewOf,
  coveringSchedule,
  findFreeStarts,
  freeStartsByDay,
  freeTimesQueryOf,
  occurrencesDuring,
  outsideWorkingTime,
  outsideWorkingTimeWithin,
} from "#/lib/availability.ts";
import type { AvailabilityInput, AvailabilitySchedule } from "#/lib/availability.ts";
import { formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { shiftDate, weekdayOf } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import { clockTime, firstMonday, minutesOf, weeklySlot } from "#/test-support/weekly-slots.ts";

// Buenos Aires is UTC-3 all year, so 09:00 there is 12:00Z. 2099-01-05 is a Monday.

const morning: AvailabilitySchedule = {
  officeId: "office-centro",
  roomId: "room-1",
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
    roomBusy: [],
    gridMinutes: 15,
    window: { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-06T03:00:00Z") },
    durationMinutes: 15,
    ...overrides,
  };
}

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

  it("skips closures", () => {
    const early = {
      start: new Date("2099-01-05T12:00:00Z"),
      end: new Date("2099-01-05T12:15:00Z"),
    };
    const late = {
      start: new Date("2099-01-05T12:45:00Z"),
      end: new Date("2099-01-05T15:00:00Z"),
    };

    expect(
      starts({
        closures: [early, late],
      }),
    ).toEqual(["2099-01-05T12:15:00.000Z", "2099-01-05T12:30:00.000Z"]);
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

  it("skips another practitioner's appointment in the schedule's room, not in another room", () => {
    const during = {
      start: new Date("2099-01-05T12:15:00Z"),
      end: new Date("2099-01-05T12:45:00Z"),
    };

    expect(starts({ roomBusy: [{ roomId: "room-1", during }] })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:45:00.000Z",
    ]);
    expect(starts({ roomBusy: [{ roomId: "room-2", during }] })).toHaveLength(4);
  });
});

describe("the window", () => {
  it("covers several days and crosses midnight in the practice's zone", () => {
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
  it("groups starts under their local date in the practice's zone, with local times", () => {
    const at = (iso: string) => ({
      start: new Date(iso),
      roomName: "Consultorio 1",
    });

    expect(freeStartsByDay([at("2099-01-06T02:30:00Z"), at("2099-01-06T12:00:00Z")])).toEqual([
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
          expect.objectContaining({ time: "09:00", start: new Date("2099-01-06T12:00:00Z") }),
        ],
      },
    ]);
  });
});

describe("the query", () => {
  const query = {
    practitionerId: "6f1c9a2e-3b4d-4e5f-8a6b-7c8d9e0f1a2b",
    firstDate: "2099-01-01",
    lastDate: "2099-01-31",
    durationMinutes: 30,
  };

  it("accepts up to 31 days, both ends included, and refuses a longer window", () => {
    expect(availabilityQuerySchema.safeParse(query).success).toBe(true);
    expect(availabilityQuerySchema.safeParse({ ...query, lastDate: "2099-02-01" }).success).toBe(
      false,
    );
  });

  it("refuses a malformed date instead of throwing", () => {
    expect(availabilityQuerySchema.safeParse({ ...query, firstDate: "" }).success).toBe(false);
    expect(availabilityQuerySchema.safeParse({ ...query, lastDate: "31/01/2099" }).success).toBe(
      false,
    );
  });

  it("accepts any whole number of minutes from 1 to 720", () => {
    const accepts = (durationMinutes: number) =>
      availabilityQuerySchema.safeParse({ ...query, durationMinutes }).success;

    expect([0, 1, 7, 720, 721, 7.5].map(accepts)).toEqual([false, true, true, true, false, false]);
  });
});

describe("the screen's view", () => {
  const practitioners = [{ id: "practitioner-1" }];

  it("defaults to the only practitioner, today, one day and 30 minutes", () => {
    expect(availabilityViewOf({}, practitioners, "2099-01-05")).toEqual({
      practitionerId: "practitioner-1",
      firstDate: "2099-01-05",
      durationMinutes: 30,
      week: false,
    });
  });

  it("leaves the practitioner unchosen when there are several, and asks for nothing", () => {
    const view = availabilityViewOf({}, [...practitioners, { id: "practitioner-2" }], "2099-01-05");

    expect(view.practitionerId).toBeUndefined();
    expect(freeTimesQueryOf(view)).toBeNull();
  });

  it("asks for seven days from the date in the week view", () => {
    const view = availabilityViewOf(
      { profesional: "practitioner-2", fecha: "2099-01-05", vista: "semana", duracion: 45 },
      practitioners,
      "2099-01-01",
    );

    expect(freeTimesQueryOf(view)).toEqual({
      practitionerId: "practitioner-2",
      firstDate: "2099-01-05",
      lastDate: "2099-01-11",
      durationMinutes: 45,
    });
  });
});

describe("a schedule's occurrences during a span", () => {
  const span = (start: string, end: string) => ({
    start: new Date(`2099-01-05T${start}:00Z`),
    end: new Date(`2099-01-05T${end}:00Z`),
  });

  it("gives the occurrence a span meets, in the schedule's zone, and none it only touches", () => {
    expect(occurrencesDuring(morning, span("12:30", "13:30"))).toEqual([
      { start: new Date("2099-01-05T12:00:00Z"), end: new Date("2099-01-05T13:00:00Z") },
    ]);
    expect(occurrencesDuring(morning, span("13:00", "13:30"))).toEqual([]);
    expect(occurrencesDuring({ ...morning, weekdays: [2] }, span("12:00", "12:30"))).toEqual([]);
  });

  it("finds the schedule whose occurrence holds the whole span, and none for a span past its end", () => {
    const later = { ...morning, roomId: "room-2", startTime: "10:00", endTime: "11:00" };

    expect(coveringSchedule([morning, later], span("13:15", "13:45"))).toBe(later);
    expect(coveringSchedule([morning, later], span("12:45", "13:15"))).toBeUndefined();
    expect(coveringSchedule([morning], span("12:00", "13:00"))).toBe(morning);
  });
});

const month = { start: new Date("2099-01-01T00:00:00Z"), end: new Date("2099-02-01T00:00:00Z") };

describe.each([
  ["one span", outsideWorkingTime],
  [
    "many spans",
    (...[span, officeId, workingTime]: Parameters<typeof outsideWorkingTime>) =>
      outsideWorkingTimeWithin(workingTime, month)(span, officeId),
  ],
])("whether a span is inside working time, %s at a time", (_form, outsideWorkingTime) => {
  const span = (start: string, end: string, date = "2099-01-05") => ({
    start: new Date(`${date}T${start}:00Z`),
    end: new Date(`${date}T${end}:00Z`),
  });
  const workingTime = (overrides: Partial<Parameters<typeof outsideWorkingTime>[2]> = {}) => ({
    schedules: [morning],
    timeOff: [],
    closures: [],
    ...overrides,
  });

  it("is inside when one occurrence of a schedule in the office holds the whole span", () => {
    expect(outsideWorkingTime(span("12:15", "12:45"), "office-centro", workingTime())).toBeNull();
    expect(outsideWorkingTime(span("12:00", "13:00"), "office-centro", workingTime())).toBeNull();
  });

  it("is outside the schedules when the span crosses a schedule's end", () => {
    expect(outsideWorkingTime(span("12:45", "13:15"), "office-centro", workingTime())).toBe(
      "outsideSchedules",
    );
  });

  it("counts only the schedules of the span's office", () => {
    const norte = { ...morning, officeId: "office-norte", roomId: "room-n" };

    expect(
      outsideWorkingTime(
        span("12:00", "12:30"),
        "office-centro",
        workingTime({ schedules: [norte] }),
      ),
    ).toBe("outsideSchedules");
  });

  it("is inside on a schedule's last date, and outside the week after", () => {
    const ending = workingTime({ schedules: [{ ...morning, lastDate: "2099-01-12" }] });

    expect(
      outsideWorkingTime(span("12:00", "12:30", "2099-01-12"), "office-centro", ending),
    ).toBeNull();
    expect(outsideWorkingTime(span("12:00", "12:30", "2099-01-19"), "office-centro", ending)).toBe(
      "outsideSchedules",
    );
  });

  it("is outside in the practitioner's time off, even when it only overlaps part of the span", () => {
    const away = workingTime({ timeOff: [span("12:20", "14:00")] });

    expect(outsideWorkingTime(span("12:00", "12:30"), "office-centro", away)).toBe("timeOff");
    expect(outsideWorkingTime(span("12:00", "12:20"), "office-centro", away)).toBeNull();
  });

  it("is outside in a closure, even when it only overlaps part of the span", () => {
    const closed = workingTime({ closures: [span("12:20", "13:00")] });

    expect(outsideWorkingTime(span("12:00", "12:30"), "office-centro", closed)).toBe("closure");
    expect(outsideWorkingTime(span("12:00", "12:20"), "office-centro", closed)).toBeNull();
  });
});

describe("the query form's own check", () => {
  const complete = { profesional: "p", fecha: "2099-01-05", duracion: 30 };

  it("accepts a complete query", () => {
    expect(availabilitySearchProblem(complete)).toBeNull();
  });

  it.each([
    ["the practitioner", { ...complete, profesional: undefined }],
    ["the date", { ...complete, fecha: undefined }],
    ["the duration", { ...complete, duracion: undefined }],
  ])("refuses a query missing %s", (_missing, search) => {
    expect(availabilitySearchProblem(search)).not.toBeNull();
  });
});

describe("free starts and working time on any input", () => {
  const minute = 60_000;
  const step = 5 * minute;
  const midnight = +instantOf(firstMonday, "00:00", practiceTimeZone);
  const days = Array.from({ length: 19 }, (_, day) => shiftDate(firstMonday, day - 1));

  const windows = fc
    .tuple(fc.integer({ min: 0, max: 13 * 288 }), fc.integer({ min: 1, max: 3 * 288 }))
    .map(([start, length]) => ({
      start: new Date(midnight + start * step),
      end: new Date(midnight + (start + length) * step),
    }));
  const rangeNear = (window: TimeRange) =>
    fc
      .tuple(
        fc.integer({ min: -24, max: (+window.end - +window.start) / step + 24 }),
        fc.integer({ min: 1, max: 120 }),
      )
      .map(([start, length]) => ({
        start: new Date(+window.start + start * step),
        end: new Date(+window.start + (start + length) * step),
      }));
  const rangesNear = (window: TimeRange) => fc.array(rangeNear(window), { maxLength: 3 });
  const schedule = fc
    .record({
      slot: weeklySlot,
      officeId: fc.constantFrom("office-a", "office-b"),
      roomId: fc.constantFrom("room-1", "room-2"),
    })
    .map(({ slot, officeId, roomId }) => ({ ...slot, officeId, roomId }));
  const inputs = windows.chain((window) =>
    fc.record({
      schedules: fc.array(schedule, { minLength: 1, maxLength: 3 }),
      timeOff: rangesNear(window),
      closures: rangesNear(window),
      busy: rangesNear(window),
      roomBusy: fc.array(
        fc.record({ roomId: fc.constantFrom("room-1", "room-2"), during: rangeNear(window) }),
        { maxLength: 3 },
      ),
      gridMinutes: fc.integer({ min: 5, max: 60 }),
      durationMinutes: fc.integer({ min: 5, max: 180 }),
      window: fc.constant(window),
    }),
  );

  const meets = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;
  const blockedFor = (input: AvailabilityInput, roomId: string) => [
    ...input.timeOff,
    ...input.closures,
    ...input.busy,
    ...input.roomBusy.filter((busy) => busy.roomId === roomId).map(({ during }) => during),
  ];
  const spanOf = (start: Date, input: AvailabilityInput) => ({
    start,
    end: new Date(+start + input.durationMinutes * minute),
  });

  // Catches a start off the grid or outside the window, a result out of time
  // order, and a span that meets something blocking it (a room's busy range
  // read for the wrong room) or that a booking would refuse as outside working time.
  it("offers only starts on the grid, in the window, in order and free for the whole duration", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const starts = findFreeStarts(input);
        starts.forEach((free, index) => {
          const span = spanOf(free.start, input);
          expect(minutesOf(formatTime(free.start, practiceTimeZone)) % input.gridMinutes).toBe(0);
          expect(+free.start).toBeGreaterThanOrEqual(+input.window.start);
          expect(+free.start).toBeLessThan(+input.window.end);
          expect(+free.start).toBeGreaterThanOrEqual(+(starts[index - 1]?.start ?? 0));
          expect(blockedFor(input, free.roomId).some((range) => meets(range, span))).toBe(false);
          expect(outsideWorkingTime(span, free.officeId, input)).toBeNull();
        });
      }),
      { numRuns: 200 },
    );
  });

  // Catches a free grid start that is never offered: the first grid point of
  // an occurrence rounded the wrong way, a last start that still fits dropped,
  // or a date of the window skipped.
  it("offers every grid start that fits a schedule and meets nothing", () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const offered = new Set(
          findFreeStarts(input).map((free) => `${+free.start} ${free.officeId} ${free.roomId}`),
        );
        for (const slot of input.schedules) {
          for (const date of days) {
            const applies =
              slot.weekdays.includes(weekdayOf(date)) &&
              slot.firstDate <= date &&
              (slot.lastDate === null || date <= slot.lastDate);
            if (!applies) {
              continue;
            }
            const occurrenceEnd = instantOf(date, slot.endTime, practiceTimeZone);
            for (let point = 0; point < 24 * 60; point += input.gridMinutes) {
              const span = spanOf(instantOf(date, clockTime(point), practiceTimeZone), input);
              const free =
                point >= minutesOf(slot.startTime) &&
                span.end <= occurrenceEnd &&
                span.start >= input.window.start &&
                span.start < input.window.end &&
                !blockedFor(input, slot.roomId).some((range) => meets(range, span));
              if (free) {
                expect(offered).toContain(`${+span.start} ${slot.officeId} ${slot.roomId}`);
              }
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Catches the fast path drifting from the one-span check: an occurrence
  // that ends with the span counted as not covering it, or a date of the
  // reach whose occurrences are left out.
  it("judges every span inside the reach as the one-span check does", () => {
    const cases = inputs.chain(({ window, ...input }) => {
      const reached = days.filter(
        (date) =>
          instantOf(date, "00:00", practiceTimeZone) < window.end &&
          instantOf(shiftDate(date, 1), "00:00", practiceTimeZone) > window.start,
      );
      const inReach = (date: string, from: number, to: number) => {
        const start = Math.max(+instantOf(date, clockTime(from), practiceTimeZone), +window.start);
        const end = Math.min(+instantOf(date, clockTime(to), practiceTimeZone), +window.end);
        return start < end ? { start: new Date(start), end: new Date(end) } : window;
      };
      const anySpan = fc
        .tuple(
          fc.constantFrom(...reached),
          fc.integer({ min: 0, max: 94 }),
          fc.integer({ min: 1, max: 32 }),
        )
        .map(([date, quarter, length]) =>
          inReach(date, quarter * 15, Math.min(quarter + length, 95) * 15),
        );
      const occurrenceTail = fc
        .tuple(fc.constantFrom(...reached), fc.constantFrom(...input.schedules), fc.nat())
        .map(([date, slot, seed]) => {
          const from = minutesOf(slot.startTime);
          const to = minutesOf(slot.endTime);
          return inReach(date, from + (seed % ((to - from) / 15)) * 15, to);
        });
      const span = fc.oneof(anySpan, occurrenceTail);
      return fc.record({
        workingTime: fc.constant({ ...input, window }),
        spans: fc.array(span, { minLength: 1, maxLength: 10 }),
        officeId: fc.constantFrom("office-a", "office-b"),
      });
    });
    fc.assert(
      fc.property(cases, ({ workingTime, spans, officeId }) => {
        const within = outsideWorkingTimeWithin(workingTime, workingTime.window);
        for (const span of spans) {
          expect(within(span, officeId)).toBe(outsideWorkingTime(span, officeId, workingTime));
        }
      }),
      { numRuns: 300 },
    );
  });
});
