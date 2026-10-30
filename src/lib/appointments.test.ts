import { describe, expect, it } from "vite-plus/test";

import { mondayOf, upcomingAppointmentsNotice } from "#/lib/appointments.ts";

describe("the notice before deactivating someone", () => {
  it("agrees with how many appointments they have", () => {
    expect(upcomingAppointmentsNotice(1)).toBe(
      "Tiene 1 turno futuro. Va a pasar a Turnos a reprogramar.",
    );
    expect(upcomingAppointmentsNotice(12)).toBe(
      "Tiene 12 turnos futuros. Van a pasar a Turnos a reprogramar.",
    );
  });
});

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
