import { describe, expect, it } from "vite-plus/test";

import { mondayOf, upcomingAppointmentsNotice } from "#/lib/appointments.ts";

describe("the notice before a deactivation", () => {
  it("agrees with how many appointments go to the list", () => {
    expect(upcomingAppointmentsNotice(1)).toBe("1 turno futuro va a pasar a Turnos a reprogramar.");
    expect(upcomingAppointmentsNotice(12)).toBe(
      "12 turnos futuros van a pasar a Turnos a reprogramar.",
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
