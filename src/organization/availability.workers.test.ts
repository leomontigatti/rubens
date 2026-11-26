import { describe, expect, it } from "vite-plus/test";

import type { AvailabilityQuery } from "#/lib/availability.ts";
import type { ScheduleInput } from "#/lib/schedules.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

import {
  addRoom,
  addStaff,
  adminCaller,
  inStorage,
  setUpTestOrganization,
  theOffice,
} from "#/organization/organization.test-support.ts";
import { practitioner as practitionerTable } from "#/organization/schema.ts";

// The practice is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday.

type Caller = typeof adminCaller;

async function world() {
  const { organization } = await setUpTestOrganization();
  const centro = await theOffice(organization);
  const room = await addRoom(organization, centro.id, "Consultorio 1");
  const juan = await addStaff(organization, "Juan Gómez");

  async function addSchedule(overrides: Partial<ScheduleInput> = {}) {
    const result = await organization.createSchedule(adminCaller, {
      practitionerId: juan.practitionerId,
      roomId: room.id,
      weekdays: [1],
      startTime: "09:00",
      endTime: "11:00",
      firstDate: "2099-01-05",
      lastDate: null,
      ...overrides,
    });
    if (!result.ok) {
      throw new Error(`createSchedule refused: ${result.reason}`);
    }
  }

  async function addTimeOff(entry: RangeEntry, practitionerId = juan.practitionerId) {
    const result = await organization.createTimeOff(adminCaller, { practitionerId, entry });
    if (!result.ok) {
      throw new Error(`createTimeOff refused: ${result.reason}`);
    }
  }

  async function addClosure(entry: RangeEntry) {
    const result = await organization.createClosure(adminCaller, { entry });
    if (!result.ok) {
      throw new Error(`createClosure refused: ${result.reason}`);
    }
  }

  const availability = (caller: Caller, overrides: Partial<AvailabilityQuery> = {}) =>
    organization.getAvailability(caller, {
      practitionerId: juan.practitionerId,
      firstDate: "2099-01-05",
      lastDate: "2099-01-05",
      durationMinutes: 30,
      ...overrides,
    });

  async function freeStarts(
    caller: Caller = adminCaller,
    overrides: Partial<AvailabilityQuery> = {},
  ) {
    const result = await availability(caller, overrides);
    if (!result.ok) {
      throw new Error(`getAvailability refused: ${result.reason}`);
    }
    return result.freeStarts.map((free) => free.start.toISOString());
  }

  return {
    organization,
    centro,
    room,
    juan,
    addSchedule,
    addTimeOff,
    addClosure,
    availability,
    freeStarts,
  };
}

const day = (date: string): RangeEntry => ({ kind: "days", firstDate: date, lastDate: date });

describe("free times for stored data", () => {
  it("returns the free starts on the practitioner's grid, with their office and room", async () => {
    const { organization, addSchedule, availability } = await world();
    await addSchedule({ endTime: "10:00" });
    await inStorage(organization, (database) =>
      database.update(practitionerTable).set({ gridMinutes: 20 }).run(),
    );

    const result = await availability(adminCaller, { durationMinutes: 20 });

    expect(result).toMatchObject({ ok: true, gridMinutes: 20 });
    expect(result.ok && result.freeStarts).toEqual([
      {
        start: new Date("2099-01-05T12:00:00Z"),
        roomName: "Consultorio 1",
      },
      expect.objectContaining({ start: new Date("2099-01-05T12:20:00Z") }),
      expect.objectContaining({ start: new Date("2099-01-05T12:40:00Z") }),
    ]);
  });

  it("leaves out the practitioner's time off and the closures", async () => {
    const { addSchedule, addTimeOff, addClosure, freeStarts } = await world();
    await addSchedule();
    await addTimeOff({ kind: "hours", start: "2099-01-05T09:00", end: "2099-01-05T09:30" });
    await addClosure({
      kind: "hours",
      start: "2099-01-05T10:00",
      end: "2099-01-05T10:30",
    });
    await addClosure({ kind: "hours", start: "2099-01-05T10:45", end: "2099-01-05T11:00" });

    // 09:30 is the only start whose half hour meets none of them; 10:30 runs
    // into the second closure.
    expect(await freeStarts()).toEqual(["2099-01-05T12:30:00.000Z"]);
  });

  it("ignores another practitioner's time off", async () => {
    const { organization, addSchedule, addTimeOff, freeStarts } = await world();
    await addSchedule({ endTime: "10:00" });
    const lucia = await addStaff(organization, "Lucía Díaz");
    await addTimeOff(day("2099-01-05"), lucia.practitionerId);

    expect(await freeStarts()).toEqual(["2099-01-05T12:00:00.000Z", "2099-01-05T12:30:00.000Z"]);
  });

  it("matches a week across two rooms to the schedules minus time off and closures", async () => {
    const { organization, centro, addSchedule, addTimeOff, addClosure, freeStarts } = await world();
    // `Consultorio 1` on Mondays and Wednesdays at 09:00, `Consultorio 2` on
    // Tuesdays and Thursdays at 14:00, an hour each, two starts each.
    await addSchedule({ weekdays: [1, 3], endTime: "10:00" });
    const otherRoom = await addRoom(organization, centro.id, "Consultorio 2");
    await addSchedule({
      roomId: otherRoom.id,
      weekdays: [2, 4],
      startTime: "14:00",
      endTime: "15:00",
    });
    // Wednesday off, and the practice closed on Thursday.
    await addTimeOff(day("2099-01-07"));
    await addClosure(day("2099-01-08"));

    expect(await freeStarts(adminCaller, { lastDate: "2099-01-11" })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-06T17:00:00.000Z",
      "2099-01-06T17:30:00.000Z",
    ]);
  });

  it("covers every day from the first to the last date", async () => {
    const { addSchedule, freeStarts } = await world();
    await addSchedule({ weekdays: [1, 3], endTime: "09:30" });

    expect(await freeStarts(adminCaller, { lastDate: "2099-01-11" })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-07T12:00:00.000Z",
    ]);
  });

  it("offers nothing in a deactivated room", async () => {
    const { organization, room, addSchedule, freeStarts } = await world();
    await addSchedule();
    await organization.setRoomActive(adminCaller, { id: room.id, active: false });

    expect(await freeStarts()).toEqual([]);
  });

  it("refuses a last date before the first, and a practitioner that does not exist", async () => {
    const { availability } = await world();

    expect(await availability(adminCaller, { lastDate: "2099-01-04" })).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(await availability(adminCaller, { practitionerId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("who reads free times", () => {
  it("lets a receptionist and the practitioner themself read them", async () => {
    const { organization, juan, addSchedule, availability } = await world();
    await addSchedule();
    const rosa = await addStaff(organization, "Rosa Ruiz", ["receptionist"]);

    expect(await availability(rosa.caller)).toMatchObject({ ok: true });
    expect(await availability(juan.caller)).toMatchObject({ ok: true });
  });

  it("refuses another practitioner", async () => {
    const { organization, availability } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");

    expect(await availability(lucia.caller)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("lists every active practitioner to reception, and only themself to a practitioner", async () => {
    const { organization, juan } = await world();
    await addStaff(organization, "Lucía Díaz");
    const rosa = await addStaff(organization, "Rosa Ruiz", ["receptionist"]);

    const names = async (caller: Caller) => {
      const listed = await organization.listAvailabilityPractitioners(caller);
      return listed.ok ? listed.practitioners.map((row) => row.displayName) : listed;
    };

    expect(await names(rosa.caller)).toEqual(["Juan Gómez", "Lucía Díaz"]);
    expect(await names(juan.caller)).toEqual(["Juan Gómez"]);
  });
});
