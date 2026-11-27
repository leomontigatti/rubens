import fc from "fast-check";

import { shiftDate } from "#/lib/schedules.ts";
import type { WeeklySlot } from "#/lib/schedules.ts";

// Arbitraries for property tests over schedules. Dates start on the Monday
// 2099-01-05 and times sit on a 15-minute grid, so ranges often touch.

export const firstMonday = "2099-01-05";

export function clockTime(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function minutesOf(time: string): number {
  const [hours = NaN, minutes = NaN] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

const quarters = fc
  .tuple(fc.integer({ min: 0, max: 94 }), fc.integer({ min: 1, max: 32 }))
  .map(([start, length]) => [start * 15, Math.min(start + length, 95) * 15]);

export const weeklySlot: fc.Arbitrary<WeeklySlot> = fc
  .record({
    weekdays: fc
      .uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 })
      .map((days) => [...days].sort((a, b) => a - b)),
    times: quarters,
    firstOffset: fc.integer({ min: 0, max: 13 }),
    length: fc.option(fc.integer({ min: 0, max: 20 })),
  })
  .map(({ weekdays, times: [start = 0, end = 15], firstOffset, length }) => {
    const firstDate = shiftDate(firstMonday, firstOffset);
    return {
      weekdays,
      startTime: clockTime(start),
      endTime: clockTime(end),
      firstDate,
      lastDate: length === null ? null : shiftDate(firstDate, length),
    };
  });
