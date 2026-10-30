import { describe, expect, it } from "vite-plus/test";

import { mondayOf } from "#/lib/appointments.ts";

describe("the week a date falls in", () => {
  it("starts on that week's Monday, the Monday itself included", () => {
    // 2099-01-05 is a Monday.
    expect(["2099-01-05", "2099-01-07", "2099-01-11"].map(mondayOf)).toEqual([
      "2099-01-05",
      "2099-01-05",
      "2099-01-05",
    ]);
    expect(mondayOf("2099-01-12")).toBe("2099-01-12");
  });
});
