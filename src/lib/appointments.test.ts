import { describe, expect, it } from "vite-plus/test";

import { agendaViewOf } from "#/lib/appointments.ts";

const offices = [{ id: "centro" }, { id: "norte" }];

describe("what the day view shows", () => {
  it("shows the first office today unless the address names others", () => {
    expect(agendaViewOf({}, offices, "2099-01-05")).toEqual({
      officeId: "centro",
      date: "2099-01-05",
    });
    expect(agendaViewOf({ sede: "norte", fecha: "2099-01-06" }, offices, "2099-01-05")).toEqual({
      officeId: "norte",
      date: "2099-01-06",
    });
  });

  it("has no office to show when there are none", () => {
    expect(agendaViewOf({}, [], "2099-01-05").officeId).toBeNull();
  });
});
