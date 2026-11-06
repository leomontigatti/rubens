import { describe, expect, it } from "vite-plus/test";

import {
  addMember,
  addStaff,
  adminCaller,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";

// The busy week the agenda's CPU budget is measured on (#139). 2099-01-05 is
// a Monday.

async function busyWeek() {
  const { organization } = await setUpTestOrganization();
  const seeded = await organization.seedAgendaWeek(adminCaller, { date: "2099-01-07" });
  const offices = await organization.listOffices(adminCaller, { includeInactive: false });
  if (!offices.ok) {
    throw new Error(`listOffices refused: ${offices.reason}`);
  }
  const office = offices.offices.find((one) => one.name === "Sede Belgrano")!;
  const found = await organization.getOffice(adminCaller, {
    officeId: office.id,
    includeInactive: false,
  });
  if (!found.ok) {
    throw new Error(`getOffice refused: ${found.reason}`);
  }
  const roomOne = found.rooms.find((one) => one.name === "Consultorio 1")!;
  return { organization, seeded, roomOne };
}

describe("the agenda's busy week", () => {
  it("books six slots per practitioner each weekday and Wednesday's overbooking", async () => {
    const { seeded } = await busyWeek();

    expect(seeded).toEqual({ ok: true, monday: "2099-01-05", booked: 121 });
  });

  it("adds nothing when the same week is seeded again", async () => {
    const { organization } = await busyWeek();

    expect(await organization.seedAgendaWeek(adminCaller, { date: "2099-01-05" })).toEqual({
      ok: true,
      monday: "2099-01-05",
      booked: 0,
    });
  });

  it("shows reception the room's two practitioners' appointments", async () => {
    const { organization, roomOne } = await busyWeek();
    const receptionist = await addMember(organization, ["receptionist"]);

    const result = await organization.getCalendarWeek(receptionist, {
      roomId: roomOne.id,
      date: "2099-01-05",
    });

    const cards = result.ok ? result.week!.days.flatMap((day) => day.cards) : [];
    expect(new Set(cards.map((card) => card.id)).size).toBe(61);
    expect(cards.filter((card) => card.kind === "appointment" && card.overbooking)).toHaveLength(1);
  });

  it("opens a seeded practitioner's calendar on their own room", async () => {
    const { organization, roomOne } = await busyWeek();

    const result = await organization.getCalendarWeek(
      { userId: "agenda-week-practitioner-1" },
      { date: "2099-01-05" },
    );

    expect(result.ok && result.week!.room.id).toBe(roomOne.id);
  });

  it("stands an existing practitioner in for practitioner 1", async () => {
    const { organization } = await setUpTestOrganization();
    const juan = await addStaff(organization, "Juan Gómez");

    await organization.seedAgendaWeek(adminCaller, {
      date: "2099-01-05",
      practitionerUserId: juan.caller.userId,
    });
    const result = await organization.getCalendarWeek(juan.caller, { date: "2099-01-05" });

    const own = result.ok ? result.week!.days.flatMap((day) => day.cards) : [];
    expect(own.filter((card) => card.kind === "appointment")).toHaveLength(31);
  });

  it("refuses anyone but an admin", async () => {
    const { organization } = await setUpTestOrganization();
    const receptionist = await addMember(organization, ["receptionist"]);

    expect(await organization.seedAgendaWeek(receptionist, { date: "2099-01-05" })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
