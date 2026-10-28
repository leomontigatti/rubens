import { describe, expect, it } from "vite-plus/test";

import { collisionLabel, datesMeet, scheduleState, validityLabel } from "#/lib/schedules.ts";

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

describe("whether two schedules share a date", () => {
  it("meets on a shared last and first date, and not on the day after", () => {
    const ending = { firstDate: "2026-11-02", lastDate: "2026-11-30" };

    expect(datesMeet(ending, { firstDate: "2026-11-30", lastDate: null })).toBe(true);
    expect(datesMeet(ending, { firstDate: "2026-12-01", lastDate: null })).toBe(false);
    expect(datesMeet({ firstDate: "2026-12-01", lastDate: null }, ending)).toBe(false);
    expect(datesMeet(open, { firstDate: "2020-01-06", lastDate: null })).toBe(true);
  });
});
