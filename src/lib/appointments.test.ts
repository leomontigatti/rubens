import { describe, expect, it } from "vite-plus/test";

import { agendaViewOf, weekViewOf } from "#/lib/appointments.ts";

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

describe("what the week view shows", () => {
  const practitioners = [{ id: "juan" }, { id: "lucia" }];

  it("shows the first practitioner's week from today, without cancelled appointments, unless the address says otherwise", () => {
    expect(weekViewOf({}, practitioners, "2099-01-05")).toEqual({
      practitionerId: "juan",
      date: "2099-01-05",
      includeCancelled: false,
    });
    expect(
      weekViewOf(
        { profesional: "lucia", fecha: "2099-01-12", cancelados: true },
        practitioners,
        "2099-01-05",
      ),
    ).toEqual({ practitionerId: "lucia", date: "2099-01-12", includeCancelled: true });
  });

  it("has no practitioner to show when there are none", () => {
    expect(weekViewOf({}, [], "2099-01-05").practitionerId).toBeNull();
  });
});
