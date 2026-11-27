import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  appointmentCollisionLabel,
  collisionLabel,
  findCollision,
  scheduleState,
  sharedDates,
  shiftDate,
  validityLabel,
  weekdayOf,
} from "#/lib/schedules.ts";
import type { WeeklySlot } from "#/lib/schedules.ts";
import { firstMonday, minutesOf, weeklySlot } from "#/test-support/weekly-slots.ts";

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

  it("tells the appointment a save would crowd, on its date", () => {
    expect(
      appointmentCollisionLabel({
        practitionerName: "Lucía Díaz",
        roomName: "Consultorio 3",
        date: "2099-01-05",
        startTime: "12:00",
        endTime: "12:30",
      }),
    ).toBe("Choca con un turno de Lucía Díaz en Consultorio 3, el 05/01/2099 de 12:00 a 12:30.");
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

describe("findCollision", () => {
  // Every date a slot below can cover, with a week to spare past the latest first date.
  const dates = Array.from({ length: 42 }, (_, day) => shiftDate(firstMonday, day));

  function collidesOn(a: WeeklySlot, b: WeeklySlot, weekday: number): boolean {
    const sharesDate = dates.some(
      (date) =>
        weekdayOf(date) === weekday &&
        [a, b].every(
          (slot) =>
            slot.weekdays.includes(weekday) &&
            slot.firstDate <= date &&
            (slot.lastDate === null || date <= slot.lastDate),
        ),
    );
    const sharesMinute = Array.from({ length: 96 }, (_, quarter) => quarter * 15).some((minute) =>
      [a, b].every(
        (slot) => minutesOf(slot.startTime) <= minute && minute < minutesOf(slot.endTime),
      ),
    );
    return sharesDate && sharesMinute;
  }

  // Catches a corner shortcut that misses a shared moment (a first date or
  // start time left out of the corners), or that reports schedules that only
  // touch, or a collision on a weekday where the other does not apply.
  it("finds a collision exactly when some moment is shared, and names a schedule that shares one", () => {
    fc.assert(
      fc.property(weeklySlot, fc.array(weeklySlot, { maxLength: 4 }), (candidate, others) => {
        const found = findCollision(candidate, others);
        const exists = candidate.weekdays.some((weekday) =>
          others.some((other) => collidesOn(candidate, other, weekday)),
        );
        expect(found !== null).toBe(exists);
        if (found) {
          expect(collidesOn(candidate, found.schedule, found.weekday)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
