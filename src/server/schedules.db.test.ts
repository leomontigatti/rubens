import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/lib/access.ts";
import { shiftDate, today } from "#/lib/schedules.ts";
import type { ScheduleChange, ScheduleInput } from "#/lib/schedules.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { setOfficeActive, setRoomActive } from "#/server/offices.ts";
import { setMemberActive } from "#/server/staff.ts";
import {
  changeSchedule,
  createSchedule,
  deleteSchedule,
  endSchedule,
  getPractitionerSchedules,
  listSchedulePractitioners,
} from "#/server/schedules.ts";

// Every service call runs as the app role, so row-level security applies as in
// the app. Dates far in the future or the past keep "today" out of the way
// unless a test is about it; 2099-01-05 and 2020-01-06 are Mondays.

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let world: Awaited<ReturnType<typeof createSchedulingWorld>>;
let roomId: string;
let practitionerId: string;
let practitioner: Actor;

beforeEach(async () => {
  db = await testDatabase.reset();
  world = await createSchedulingWorld(db);
  const office = await world.addOffice();
  roomId = (await world.addRoom(office.id)).id;
  const staff = await world.addStaff("Juan Gómez");
  practitioner = staff.actor;
  practitionerId = await practitionerIdOf("Juan Gómez");
});

async function practitionerIdOf(displayName: string) {
  const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
  return listed.find((row) => row.displayName === displayName)!.id;
}

function mondayMorning(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    practitionerId,
    roomId,
    weekdays: [1],
    startTime: "09:00",
    endTime: "13:00",
    firstDate: "2099-01-05",
    lastDate: null,
    ...overrides,
  };
}

function create(actor: Actor, input: ScheduleInput) {
  return asAppRole(db, (tx) => createSchedule(actor, input, tx));
}

async function schedulesOf(id = practitionerId) {
  const result = await asAppRole(db, (tx) =>
    getPractitionerSchedules(world.admin, { practitionerId: id }, tx),
  );
  if (!result.ok) {
    throw new Error(`getPractitionerSchedules failed: ${result.reason}`);
  }
  return result.schedules;
}

describe("creating a schedule", () => {
  it("stores the weekly fields with the room and office it holds", async () => {
    const result = await create(
      world.admin,
      mondayMorning({ weekdays: [3, 1, 3], lastDate: "2099-06-29" }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        roomId,
        roomName: "Consultorio 1",
        officeName: "Sede Centro",
        weekdays: [1, 3],
        startTime: "09:00",
        endTime: "13:00",
        firstDate: "2099-01-05",
        lastDate: "2099-06-29",
      }),
    ]);
  });
});

describe("who changes schedules", () => {
  it("lets a practitioner create their own schedule", async () => {
    expect(await create(practitioner, mondayMorning())).toMatchObject({ ok: true });
  });

  it("refuses a practitioner another practitioner's schedule", async () => {
    await world.addStaff("Lucía Díaz");
    const other = await practitionerIdOf("Lucía Díaz");

    expect(await create(practitioner, mondayMorning({ practitionerId: other }))).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses a receptionist, who still reads every schedule", async () => {
    const { actor: receptionist } = await world.addStaff("Rosa Paz", ["receptionist"]);
    await create(world.admin, mondayMorning());

    expect(
      await create(receptionist, mondayMorning({ startTime: "14:00", endTime: "18:00" })),
    ).toEqual({ ok: false, reason: "forbidden" });
    const seen = await asAppRole(db, (tx) =>
      getPractitionerSchedules(receptionist, { practitionerId }, tx),
    );
    expect(seen).toMatchObject({ ok: true, practitioner: { canEdit: false } });
    expect(seen.ok && seen.schedules).toHaveLength(1);
  });
});

describe("validating a schedule", () => {
  it.each([
    ["no weekday", { weekdays: [] }],
    ["a start after the end", { startTime: "13:00", endTime: "09:00" }],
    ["a start equal to the end", { startTime: "09:00", endTime: "09:00" }],
    ["a last date before the first", { firstDate: "2099-01-12", lastDate: "2099-01-05" }],
  ])("refuses %s", async (_, overrides) => {
    expect(await create(world.admin, mondayMorning(overrides))).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(await schedulesOf()).toEqual([]);
  });

  it("refuses a deactivated room, office or practitioner", async () => {
    const office = await world.addOffice("Sede Norte");
    const inactiveRoom = await world.addRoom(office.id, "Consultorio 9");
    await asAppRole(db, (tx) =>
      setRoomActive(world.admin, { id: inactiveRoom.id, active: false }, tx),
    );
    const closedOffice = await world.addOffice("Sede Sur");
    const roomInClosed = await world.addRoom(closedOffice.id);
    await asAppRole(db, (tx) =>
      setOfficeActive(world.admin, { id: closedOffice.id, active: false }, tx),
    );
    const { member } = await world.addStaff("Lucía Díaz");
    const leaving = await practitionerIdOf("Lucía Díaz");
    await asAppRole(db, (tx) =>
      setMemberActive(world.admin, { memberId: member.memberId, active: false }, tx),
    );

    expect(await create(world.admin, mondayMorning({ roomId: inactiveRoom.id }))).toEqual({
      ok: false,
      reason: "roomInactive",
    });
    expect(await create(world.admin, mondayMorning({ roomId: roomInClosed.id }))).toEqual({
      ok: false,
      reason: "officeInactive",
    });
    expect(await create(world.admin, mondayMorning({ practitionerId: leaving }))).toEqual({
      ok: false,
      reason: "practitionerInactive",
    });
  });
});

describe("room capacity", () => {
  async function createFor(name: string, overrides: Partial<ScheduleInput> = {}) {
    await world.addStaff(name);
    return create(
      world.admin,
      mondayMorning({ practitionerId: await practitionerIdOf(name), ...overrides }),
    );
  }

  it("refuses a second overlapping schedule in a room for one, naming the first", async () => {
    await create(world.admin, mondayMorning());

    expect(
      await createFor("Lucía Díaz", { weekdays: [1, 2], startTime: "12:00", endTime: "16:00" }),
    ).toEqual({
      ok: false,
      reason: "roomFull",
      collision: {
        practitionerName: "Juan Gómez",
        roomName: "Consultorio 1",
        weekday: 1,
        startTime: "09:00",
        endTime: "13:00",
      },
    });
  });

  it("accepts schedules that only touch end to end", async () => {
    await create(world.admin, mondayMorning());

    expect(await createFor("Lucía Díaz", { startTime: "13:00", endTime: "17:00" })).toMatchObject({
      ok: true,
    });
  });

  it("never collides schedules whose dates or weekdays do not overlap", async () => {
    await create(world.admin, mondayMorning({ lastDate: "2099-02-23" }));

    expect(await createFor("Lucía Díaz", { firstDate: "2099-03-02" })).toMatchObject({ ok: true });
    expect(await createFor("Rosa Paz", { weekdays: [2] })).toMatchObject({ ok: true });
  });

  it("accepts a second practitioner in a room for two and refuses a third", async () => {
    const office = await world.addOffice("Sede Norte");
    const shared = await world.addRoom(office.id, "Gimnasio", 2);
    await create(world.admin, mondayMorning({ roomId: shared.id }));

    expect(
      await createFor("Lucía Díaz", { roomId: shared.id, startTime: "11:00", endTime: "15:00" }),
    ).toMatchObject({ ok: true });
    expect(
      await createFor("Rosa Paz", { roomId: shared.id, startTime: "12:00", endTime: "12:30" }),
    ).toMatchObject({ ok: false, reason: "roomFull" });
    expect(
      await createFor("Pedro Ruiz", { roomId: shared.id, startTime: "13:00", endTime: "14:00" }),
    ).toMatchObject({ ok: true });
  });

  it("counts only the schedules present at the same moment in a room for two", async () => {
    const office = await world.addOffice("Sede Norte");
    const shared = await world.addRoom(office.id, "Gimnasio", 2);
    // Two schedules in turn, never together: a third over both meets one at a time.
    await create(world.admin, mondayMorning({ roomId: shared.id, lastDate: "2099-02-23" }));
    await createFor("Lucía Díaz", { roomId: shared.id, firstDate: "2099-03-02" });

    expect(
      await createFor("Rosa Paz", { roomId: shared.id, startTime: "10:00", endTime: "11:00" }),
    ).toMatchObject({ ok: true });
  });
});

describe("practitioner overlap", () => {
  it("refuses one practitioner in two rooms at once, and accepts a break between", async () => {
    const office = await world.addOffice("Sede Norte");
    const elsewhere = await world.addRoom(office.id, "Consultorio 2");
    await create(world.admin, mondayMorning());

    expect(
      await create(
        world.admin,
        mondayMorning({ roomId: elsewhere.id, startTime: "12:00", endTime: "18:00" }),
      ),
    ).toEqual({
      ok: false,
      reason: "practitionerBusy",
      collision: {
        practitionerName: "Juan Gómez",
        roomName: "Consultorio 1",
        weekday: 1,
        startTime: "09:00",
        endTime: "13:00",
      },
    });
    expect(
      await create(
        world.admin,
        mondayMorning({ roomId: elsewhere.id, startTime: "14:00", endTime: "18:00" }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("refuses one practitioner in two time zones at once, and accepts them in turn", async () => {
    const office = await world.addOffice("Sede Madrid", "Europe/Madrid");
    const abroad = await world.addRoom(office.id, "Consultorio 2");
    await create(world.admin, mondayMorning({ lastDate: "2099-02-23" }));
    // Tuesdays never meet Mondays, yet the zones alone refuse the dates in common.
    const tuesday = { roomId: abroad.id, weekdays: [2] };

    expect(await create(world.admin, mondayMorning(tuesday))).toEqual({
      ok: false,
      reason: "otherTimeZone",
    });
    expect(
      await create(world.admin, mondayMorning({ ...tuesday, firstDate: "2099-02-24" })),
    ).toMatchObject({ ok: true });
  });

  it("compares the clocks over the dates two schedules share, not from the new one's start", async () => {
    // San Luis kept a clock of its own in 2009, and has kept Buenos Aires' since.
    const office = await world.addOffice("Sede San Luis", "America/Argentina/San_Luis");
    const sanLuis = await world.addRoom(office.id, "Consultorio 2");
    await create(world.admin, mondayMorning({ roomId: sanLuis.id, weekdays: [2] }));

    expect(await create(world.admin, mondayMorning({ firstDate: "2009-01-05" }))).toMatchObject({
      ok: true,
    });
  });
});

describe("changing a schedule from a date", () => {
  const zone = "America/Argentina/Buenos_Aires";

  async function onlySchedule() {
    const [found] = await schedulesOf();
    return found!;
  }

  function change(actor: Actor, input: ScheduleChange) {
    return asAppRole(db, (tx) => changeSchedule(actor, input, tx));
  }

  it("ends a started schedule the day before and starts the new fields on the date", async () => {
    await create(world.admin, mondayMorning({ firstDate: "2020-01-06" }));
    const started = await onlySchedule();
    const from = shiftDate(today(zone), 7);

    const result = await change(world.admin, {
      scheduleId: started.id,
      from,
      roomId,
      weekdays: [1],
      startTime: "14:00",
      endTime: "18:00",
      lastDate: null,
    });

    expect(result).toMatchObject({ ok: true });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        id: started.id,
        startTime: "09:00",
        firstDate: "2020-01-06",
        lastDate: shiftDate(from, -1),
      }),
      expect.objectContaining({ startTime: "14:00", firstDate: from, lastDate: null }),
    ]);
  });

  it("edits a schedule that has not started in place", async () => {
    await create(world.admin, mondayMorning());
    const future = await onlySchedule();

    await change(practitioner, {
      scheduleId: future.id,
      from: "2099-01-12",
      roomId,
      weekdays: [2],
      startTime: "10:00",
      endTime: "14:00",
      lastDate: null,
    });

    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        id: future.id,
        weekdays: [2],
        startTime: "10:00",
        firstDate: "2099-01-12",
      }),
    ]);
  });

  it("refuses a change that collides, leaving the schedule as it was", async () => {
    await create(world.admin, mondayMorning({ firstDate: "2020-01-06" }));
    const started = await onlySchedule();
    await world.addStaff("Lucía Díaz");
    await create(
      world.admin,
      mondayMorning({
        practitionerId: await practitionerIdOf("Lucía Díaz"),
        startTime: "14:00",
        endTime: "18:00",
      }),
    );

    const result = await change(world.admin, {
      scheduleId: started.id,
      from: shiftDate(today(zone), 7),
      roomId,
      weekdays: [1],
      startTime: "13:00",
      endTime: "15:00",
      lastDate: null,
    });

    expect(result).toMatchObject({ ok: false, reason: "roomFull" });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({ id: started.id, startTime: "09:00", lastDate: null }),
    ]);
  });

  it("refuses a date in the past, and another practitioner's schedule", async () => {
    await create(world.admin, mondayMorning({ firstDate: "2020-01-06" }));
    const started = await onlySchedule();
    const { actor: other } = await world.addStaff("Lucía Díaz");
    const fields = { roomId, weekdays: [1], startTime: "14:00", endTime: "18:00", lastDate: null };

    expect(
      await change(world.admin, {
        scheduleId: started.id,
        from: shiftDate(today(zone), -1),
        ...fields,
      }),
    ).toEqual({ ok: false, reason: "dateInPast" });
    expect(
      await change(other, { scheduleId: started.id, from: shiftDate(today(zone), 7), ...fields }),
    ).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("ending and deleting a schedule", () => {
  const zone = "America/Argentina/Buenos_Aires";

  it("ends a schedule on a date, never earlier than yesterday", async () => {
    await create(world.admin, mondayMorning({ firstDate: "2020-01-06" }));
    const [started] = await schedulesOf();
    const lastDate = shiftDate(today(zone), 30);

    expect(
      await asAppRole(db, (tx) =>
        endSchedule(
          world.admin,
          { scheduleId: started!.id, lastDate: shiftDate(today(zone), -2) },
          tx,
        ),
      ),
    ).toEqual({ ok: false, reason: "dateInPast" });
    expect(
      await asAppRole(db, (tx) =>
        endSchedule(practitioner, { scheduleId: started!.id, lastDate }, tx),
      ),
    ).toEqual({ ok: true });
    expect(await schedulesOf()).toEqual([expect.objectContaining({ lastDate })]);
  });

  it("deletes a schedule before its first date, and refuses once it has started", async () => {
    await create(world.admin, mondayMorning());
    await create(world.admin, mondayMorning({ firstDate: "2020-01-06", lastDate: "2020-12-28" }));
    const [started, future] = await schedulesOf();

    const remove = (scheduleId: string) =>
      asAppRole(db, (tx) => deleteSchedule(world.admin, { scheduleId }, tx));

    expect(await remove(started!.id)).toEqual({ ok: false, reason: "alreadyStarted" });
    expect(await remove(future!.id)).toEqual({ ok: true });
    expect((await schedulesOf()).map((row) => row.id)).toEqual([started!.id]);
  });
});
