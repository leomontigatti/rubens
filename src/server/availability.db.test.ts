import { beforeEach, describe, expect, it } from "vite-plus/test";

import { practitioner as practitionerTable } from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import type { ScheduleInput } from "#/lib/schedules.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { getAvailability, listAvailabilityPractitioners } from "#/server/availability.ts";
import { createClosure } from "#/server/closures.ts";
import { setRoomActive } from "#/server/offices.ts";
import { createSchedule, listSchedulePractitioners } from "#/server/schedules.ts";
import { createTimeOff } from "#/server/time-off.ts";

// Every service call runs as the app role. The offices are in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday.

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let world: Awaited<ReturnType<typeof createSchedulingWorld>>;
let centro: { id: string };
let otherOffice: { id: string };
let roomId: string;
let practitionerId: string;
let practitioner: Actor;

beforeEach(async () => {
  db = await testDatabase.reset();
  world = await createSchedulingWorld(db);
  centro = await world.addOffice("Sede Centro");
  otherOffice = await world.addOffice("Sede Norte");
  roomId = (await world.addRoom(centro.id, "Consultorio 1")).id;
  practitioner = (await world.addStaff("Juan Gómez")).actor;
  practitionerId = await practitionerIdOf("Juan Gómez");
});

async function practitionerIdOf(displayName: string) {
  const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
  return listed.find((row) => row.displayName === displayName)!.id;
}

async function addSchedule(overrides: Partial<ScheduleInput> = {}) {
  const result = await asAppRole(db, (tx) =>
    createSchedule(
      world.admin,
      {
        practitionerId,
        roomId,
        weekdays: [1],
        startTime: "09:00",
        endTime: "11:00",
        firstDate: "2099-01-05",
        lastDate: null,
        ...overrides,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`createSchedule failed: ${result.reason}`);
  }
}

async function addTimeOff(entry: RangeEntry) {
  const result = await asAppRole(db, (tx) =>
    createTimeOff(world.admin, { practitionerId, entry }, tx),
  );
  if (!result.ok) {
    throw new Error(`createTimeOff failed: ${result.reason}`);
  }
}

async function addClosure(officeId: string | null, entry: RangeEntry) {
  const result = await asAppRole(db, (tx) => createClosure(world.admin, { officeId, entry }, tx));
  if (!result.ok) {
    throw new Error(`createClosure failed: ${result.reason}`);
  }
}

function availability(actor: Actor, overrides: Partial<AvailabilityQuery> = {}) {
  return asAppRole(db, (tx) =>
    getAvailability(
      actor,
      {
        practitionerId,
        firstDate: "2099-01-05",
        lastDate: "2099-01-05",
        durationMinutes: 30,
        ...overrides,
      },
      tx,
    ),
  );
}

async function freeStarts(actor: Actor = world.admin, overrides: Partial<AvailabilityQuery> = {}) {
  const result = await availability(actor, overrides);
  if (!result.ok) {
    throw new Error(`getAvailability failed: ${result.reason}`);
  }
  return result.freeStarts.map((free) => free.start.toISOString());
}

describe("free times for stored data", () => {
  it("returns the free starts on the practitioner's grid, with their office and room", async () => {
    await addSchedule({ endTime: "10:00" });
    await db.update(practitionerTable).set({ gridMinutes: 20 });

    const result = await availability(world.admin, { durationMinutes: 20 });

    expect(result).toMatchObject({ ok: true, gridMinutes: 20 });
    expect(result.ok && result.freeStarts).toEqual([
      expect.objectContaining({
        start: new Date("2099-01-05T12:00:00Z"),
        officeName: "Sede Centro",
        roomName: "Consultorio 1",
        timeZone: "America/Argentina/Buenos_Aires",
      }),
      expect.objectContaining({ start: new Date("2099-01-05T12:20:00Z") }),
      expect.objectContaining({ start: new Date("2099-01-05T12:40:00Z") }),
    ]);
  });

  it("leaves out the practitioner's time off and the closures of their office and the organization", async () => {
    await addSchedule();
    await addTimeOff({ kind: "hours", start: "2099-01-05T09:00", end: "2099-01-05T09:30" });
    await addClosure(centro.id, {
      kind: "hours",
      start: "2099-01-05T10:00",
      end: "2099-01-05T10:30",
    });
    await addClosure(null, { kind: "hours", start: "2099-01-05T10:45", end: "2099-01-05T11:00" });

    // 09:30 is the only start whose half hour meets none of them; 10:30 runs
    // into the organization's closure.
    expect(await freeStarts()).toEqual(["2099-01-05T12:30:00.000Z"]);
  });

  it("ignores another practitioner's time off and another office's closures", async () => {
    await addSchedule({ endTime: "10:00" });
    // The practitioner also works at the closed office that afternoon, and
    // loses only those starts.
    const norteRoom = await world.addRoom(otherOffice.id, "Consultorio Norte");
    await addSchedule({ roomId: norteRoom.id, startTime: "14:00", endTime: "15:00" });
    await world.addStaff("Lucía Díaz");
    const otherId = await practitionerIdOf("Lucía Díaz");
    await asAppRole(db, (tx) =>
      createTimeOff(
        world.admin,
        {
          practitionerId: otherId,
          entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
        },
        tx,
      ),
    );
    await addClosure(otherOffice.id, {
      kind: "days",
      firstDate: "2099-01-05",
      lastDate: "2099-01-05",
    });

    expect(await freeStarts()).toEqual(["2099-01-05T12:00:00.000Z", "2099-01-05T12:30:00.000Z"]);
  });

  it("covers every day from the first to the last date", async () => {
    await addSchedule({ weekdays: [1, 3], endTime: "09:30" });

    expect(await freeStarts(world.admin, { lastDate: "2099-01-11" })).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-07T12:00:00.000Z",
    ]);
  });

  it("offers nothing in a deactivated room", async () => {
    await addSchedule();
    await asAppRole(db, (tx) => setRoomActive(world.admin, { id: roomId, active: false }, tx));

    expect(await freeStarts()).toEqual([]);
  });

  it("refuses a last date before the first", async () => {
    expect(await availability(world.admin, { lastDate: "2099-01-04" })).toEqual({
      ok: false,
      reason: "invalidInput",
    });
  });
});

describe("who reads free times", () => {
  it("lets a receptionist and the practitioner themself read them", async () => {
    await addSchedule();
    const receptionist = (await world.addStaff("Rosa Ruiz", ["receptionist"])).actor;

    expect(await availability(receptionist)).toMatchObject({ ok: true });
    expect(await availability(practitioner)).toMatchObject({ ok: true });
  });

  it("refuses another practitioner", async () => {
    const other = (await world.addStaff("Lucía Díaz")).actor;

    expect(await availability(other)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("lists every active practitioner to reception, and only themself to a practitioner", async () => {
    await world.addStaff("Lucía Díaz");
    const receptionist = (await world.addStaff("Rosa Ruiz", ["receptionist"])).actor;

    const names = async (actor: Actor) =>
      (await asAppRole(db, (tx) => listAvailabilityPractitioners(actor, tx))).map(
        (row) => row.displayName,
      );

    expect(await names(receptionist)).toEqual(["Juan Gómez", "Lucía Díaz"]);
    expect(await names(practitioner)).toEqual(["Juan Gómez"]);
  });
});
