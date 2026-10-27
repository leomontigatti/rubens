import { describe, expect, it } from "vite-plus/test";

import { scheduleState } from "#/lib/schedules.ts";

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
