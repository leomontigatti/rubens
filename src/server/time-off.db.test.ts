import { beforeEach, describe, expect, it } from "vite-plus/test";

import { timeOff } from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { listSchedulePractitioners } from "#/server/schedules.ts";
import { createTimeOff, deleteTimeOff, listTimeOff, updateTimeOff } from "#/server/time-off.ts";

// Every service call runs as the app role. Time off is read in the
// organization's default zone, Buenos Aires (UTC-3).

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let world: Awaited<ReturnType<typeof createSchedulingWorld>>;
let practitionerId: string;
let practitioner: Actor;

const vacation: RangeEntry = { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-09" };
const afternoon: RangeEntry = { kind: "hours", start: "2099-01-12T14:00", end: "2099-01-12T18:00" };

beforeEach(async () => {
  db = await testDatabase.reset();
  world = await createSchedulingWorld(db);
  practitioner = (await world.addStaff("Juan Gómez")).actor;
  practitionerId = await practitionerIdOf("Juan Gómez");
});

async function practitionerIdOf(displayName: string) {
  const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
  return listed.find((row) => row.displayName === displayName)!.id;
}

function create(actor: Actor, entry: RangeEntry, id = practitionerId) {
  return asAppRole(db, (tx) => createTimeOff(actor, { practitionerId: id, entry }, tx));
}

async function createdId(actor: Actor, entry: RangeEntry, id = practitionerId) {
  const result = await create(actor, entry, id);
  if (!result.ok) {
    throw new Error(`createTimeOff failed: ${result.reason}`);
  }
  return result.timeOff.id;
}

function list(actor: Actor) {
  return asAppRole(db, (tx) => listTimeOff(actor, tx));
}

/** The stored ranges, read as the owner. */
async function storedRanges() {
  const rows = await db.select().from(timeOff);
  return rows.map((row) => row.during);
}

describe("recording time off", () => {
  it("stores whole days from local midnight to the midnight after the last day", async () => {
    expect(await create(world.admin, vacation)).toMatchObject({ ok: true });

    expect(await storedRanges()).toEqual([
      { start: new Date("2099-01-05T03:00:00Z"), end: new Date("2099-01-10T03:00:00Z") },
    ]);
    expect((await list(world.admin)).timeOff).toEqual([
      expect.objectContaining({ practitionerId, practitionerName: "Juan Gómez", entry: vacation }),
    ]);
  });

  it("stores a range of hours as the local times entered", async () => {
    await create(world.admin, afternoon);

    expect(await storedRanges()).toEqual([
      { start: new Date("2099-01-12T17:00:00Z"), end: new Date("2099-01-12T21:00:00Z") },
    ]);
  });

  it("allows time off that overlaps other time off", async () => {
    await create(world.admin, vacation);

    expect(
      await create(world.admin, { kind: "days", firstDate: "2099-01-07", lastDate: "2099-01-07" }),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, RangeEntry]>([
    ["hours ending before they start", { ...afternoon, end: "2099-01-12T13:00" } as RangeEntry],
    ["hours ending as they start", { ...afternoon, end: afternoon.start } as RangeEntry],
    ["a last day before the first", { ...vacation, lastDate: "2099-01-04" } as RangeEntry],
  ])("refuses %s", async (_, entry) => {
    expect(await create(world.admin, entry)).toEqual({ ok: false, reason: "invalidInput" });
    expect(await storedRanges()).toEqual([]);
  });

  it("refuses a practitioner that does not exist", async () => {
    expect(await create(world.admin, vacation, crypto.randomUUID())).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("who records time off", () => {
  it("lets a practitioner record their own", async () => {
    expect(await create(practitioner, vacation)).toMatchObject({ ok: true });
  });

  it("refuses a practitioner another practitioner's time off", async () => {
    await world.addStaff("Lucía Díaz");
    const other = await practitionerIdOf("Lucía Díaz");

    expect(await create(practitioner, vacation, other)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("refuses a receptionist, who still reads everyone's time off", async () => {
    const { actor: receptionist } = await world.addStaff("Rosa Paz", ["receptionist"]);
    await create(world.admin, vacation);

    expect(await create(receptionist, afternoon)).toEqual({ ok: false, reason: "forbidden" });
    expect(await list(receptionist)).toMatchObject({
      timeOff: [{ practitionerId, canEdit: false }],
      practitioners: [],
    });
  });

  it("offers a practitioner only themself, and marks only their own as editable", async () => {
    await world.addStaff("Lucía Díaz");
    const other = await practitionerIdOf("Lucía Díaz");
    await create(world.admin, vacation, other);
    await create(world.admin, afternoon);

    const seen = await list(practitioner);
    expect(seen.practitioners).toEqual([{ id: practitionerId, displayName: "Juan Gómez" }]);
    expect(seen.timeOff.map((row) => [row.practitionerName, row.canEdit])).toEqual([
      ["Juan Gómez", true],
      ["Lucía Díaz", false],
    ]);
  });
});

describe("editing and deleting time off", () => {
  it("replaces the range", async () => {
    const id = await createdId(practitioner, vacation);

    expect(
      await asAppRole(db, (tx) =>
        updateTimeOff(practitioner, { timeOffId: id, entry: afternoon }, tx),
      ),
    ).toEqual({ ok: true });
    expect((await list(world.admin)).timeOff).toEqual([
      expect.objectContaining({ id, entry: afternoon }),
    ]);
  });

  it("deletes it", async () => {
    const id = await createdId(world.admin, vacation);

    expect(await asAppRole(db, (tx) => deleteTimeOff(practitioner, { timeOffId: id }, tx))).toEqual(
      {
        ok: true,
      },
    );
    expect(await storedRanges()).toEqual([]);
  });

  it("refuses another practitioner and a receptionist", async () => {
    await world.addStaff("Lucía Díaz");
    const other = await practitionerIdOf("Lucía Díaz");
    const id = await createdId(world.admin, vacation, other);
    const { actor: receptionist } = await world.addStaff("Rosa Paz", ["receptionist"]);

    for (const actor of [practitioner, receptionist]) {
      expect(
        await asAppRole(db, (tx) => updateTimeOff(actor, { timeOffId: id, entry: afternoon }, tx)),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(await asAppRole(db, (tx) => deleteTimeOff(actor, { timeOffId: id }, tx))).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
    expect(await storedRanges()).toHaveLength(1);
  });

  it("refuses time off that does not exist", async () => {
    expect(
      await asAppRole(db, (tx) =>
        deleteTimeOff(world.admin, { timeOffId: crypto.randomUUID() }, tx),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
