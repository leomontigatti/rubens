import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { shiftDate, today } from "#/lib/schedules.ts";
import type { ScheduleChange, ScheduleInput } from "#/lib/schedules.ts";

import {
  addOffice,
  addRoom,
  addStaff,
  adminCaller,
  auditEntriesFor,
  expectOk,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { member } from "#/organization/schema.ts";

// Dates far in the future or the past keep "today" out of the way unless a
// test is about it; 2099-01-05 and 2020-01-06 are Mondays. The offices are in
// Buenos Aires (UTC-3) unless a test names another zone.

const zone = "America/Argentina/Buenos_Aires";

type Caller = typeof adminCaller;

async function world() {
  const { organization } = await setUpTestOrganization();
  const centro = await addOffice(organization, "Sede Centro");
  const room = await addRoom(organization, centro.id, "Consultorio 1");
  const juan = await addStaff(organization, "Juan Gómez");

  const mondayMorning = (overrides: Partial<ScheduleInput> = {}): ScheduleInput => ({
    practitionerId: juan.practitionerId,
    roomId: room.id,
    weekdays: [1],
    startTime: "09:00",
    endTime: "13:00",
    firstDate: "2099-01-05",
    lastDate: null,
    ...overrides,
  });

  const create = (caller: Caller, input: ScheduleInput) =>
    organization.createSchedule(caller, input);

  async function createdId(input: ScheduleInput) {
    const result = await create(adminCaller, input);
    if (!result.ok) {
      throw new Error(`createSchedule refused: ${result.reason}`);
    }
    return result.schedule.id;
  }

  async function schedulesOf(practitionerId = juan.practitionerId) {
    const result = await organization.getPractitionerSchedules(adminCaller, { practitionerId });
    if (!result.ok) {
      throw new Error(`getPractitionerSchedules refused: ${result.reason}`);
    }
    return result.schedules;
  }

  /** A schedule for a new practitioner named `name`. */
  async function createFor(name: string, overrides: Partial<ScheduleInput> = {}) {
    const other = await addStaff(organization, name);
    return create(
      adminCaller,
      mondayMorning({ practitionerId: other.practitionerId, ...overrides }),
    );
  }

  return { organization, room, juan, mondayMorning, create, createdId, schedulesOf, createFor };
}

describe("creating a schedule", () => {
  it("stores the weekly fields with the room and office it holds, and audits it", async () => {
    const { organization, room, mondayMorning, create, schedulesOf } = await world();

    const result = await create(
      adminCaller,
      mondayMorning({ weekdays: [3, 1, 3], lastDate: "2099-06-29" }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        roomId: room.id,
        roomName: "Consultorio 1",
        officeName: "Sede Centro",
        timeZone: zone,
        weekdays: [1, 3],
        startTime: "09:00",
        endTime: "13:00",
        firstDate: "2099-01-05",
        lastDate: "2099-06-29",
      }),
    ]);
    expect(await auditEntriesFor(organization, result.ok ? result.schedule.id : "")).toEqual([
      expect.objectContaining({
        action: "create",
        entityType: "schedule",
        userId: adminCaller.userId,
        patientId: null,
        before: null,
        after: expect.objectContaining({ weekdays: "1,3", startTime: "09:00" }),
      }),
    ]);
  });
});

describe("who changes schedules", () => {
  it("lets a practitioner create their own schedule", async () => {
    const { juan, mondayMorning, create } = await world();

    expect(await create(juan.caller, mondayMorning())).toMatchObject({ ok: true });
  });

  it("refuses a practitioner another practitioner's schedule", async () => {
    const { organization, juan, mondayMorning, create } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");

    expect(
      await create(juan.caller, mondayMorning({ practitionerId: lucia.practitionerId })),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("refuses a receptionist, who still reads every schedule", async () => {
    const { organization, juan, mondayMorning, create } = await world();
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);
    await create(adminCaller, mondayMorning());

    expect(
      await create(rosa.caller, mondayMorning({ startTime: "14:00", endTime: "18:00" })),
    ).toEqual({ ok: false, reason: "forbidden" });
    const seen = await organization.getPractitionerSchedules(rosa.caller, {
      practitionerId: juan.practitionerId,
    });
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
    const { mondayMorning, create, schedulesOf } = await world();

    expect(await create(adminCaller, mondayMorning(overrides))).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(await schedulesOf()).toEqual([]);
  });

  it("refuses a deactivated room, office or practitioner", async () => {
    const { organization, mondayMorning, create } = await world();
    const norte = await addOffice(organization, "Sede Norte");
    const inactiveRoom = await addRoom(organization, norte.id, "Consultorio 9");
    await organization.setRoomActive(adminCaller, { id: inactiveRoom.id, active: false });
    const sur = await addOffice(organization, "Sede Sur");
    const roomInClosed = await addRoom(organization, sur.id, "Consultorio 1");
    await organization.setOfficeActive(adminCaller, { id: sur.id, active: false });
    const leaving = await addStaff(organization, "Lucía Díaz");
    await inStorage(organization, (database) =>
      database
        .update(member)
        .set({ active: false })
        .where(eq(member.userId, leaving.caller.userId))
        .run(),
    );

    expect(await create(adminCaller, mondayMorning({ roomId: inactiveRoom.id }))).toEqual({
      ok: false,
      reason: "roomInactive",
    });
    expect(await create(adminCaller, mondayMorning({ roomId: roomInClosed.id }))).toEqual({
      ok: false,
      reason: "officeInactive",
    });
    expect(
      await create(adminCaller, mondayMorning({ practitionerId: leaving.practitionerId })),
    ).toEqual({ ok: false, reason: "practitionerInactive" });
  });
});

describe("room capacity", () => {
  it("refuses a second overlapping schedule in a room for one, naming the first", async () => {
    const { mondayMorning, create, createFor } = await world();
    await create(adminCaller, mondayMorning());

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
    const { mondayMorning, create, createFor } = await world();
    await create(adminCaller, mondayMorning());

    expect(await createFor("Lucía Díaz", { startTime: "13:00", endTime: "17:00" })).toMatchObject({
      ok: true,
    });
  });

  it("never collides schedules whose dates or weekdays do not overlap", async () => {
    const { mondayMorning, create, createFor } = await world();
    await create(adminCaller, mondayMorning({ lastDate: "2099-02-23" }));

    expect(await createFor("Lucía Díaz", { firstDate: "2099-03-02" })).toMatchObject({ ok: true });
    expect(await createFor("Rosa Paz", { weekdays: [2] })).toMatchObject({ ok: true });
  });

  it("accepts a second practitioner in a room for two and refuses a third", async () => {
    const { organization, mondayMorning, create, createFor } = await world();
    const norte = await addOffice(organization, "Sede Norte");
    const shared = await addRoom(organization, norte.id, "Gimnasio", 2);
    await create(adminCaller, mondayMorning({ roomId: shared.id }));

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
    const { organization, mondayMorning, create, createFor } = await world();
    const norte = await addOffice(organization, "Sede Norte");
    const shared = await addRoom(organization, norte.id, "Gimnasio", 2);
    // Two schedules in turn, never together: a third over both meets one at a time.
    await create(adminCaller, mondayMorning({ roomId: shared.id, lastDate: "2099-02-23" }));
    await createFor("Lucía Díaz", { roomId: shared.id, firstDate: "2099-03-02" });

    expect(
      await createFor("Rosa Paz", { roomId: shared.id, startTime: "10:00", endTime: "11:00" }),
    ).toMatchObject({ ok: true });
  });
});

describe("a schedule saved in a room an appointment holds", () => {
  /**
   * Books an overbooking for `practitionerId` in `roomId` on 2099-01-05, 12:00
   * to 12:30 local, outside any schedule, and cancels it when asked.
   */
  async function storeAppointment(
    organization: OrganizationStub,
    practitionerId: string,
    roomId: string,
    status: "booked" | "cancelled" = "booked",
  ) {
    const registered = expectOk(
      await organization.registerPatient(adminCaller, {
        firstName: "María",
        lastName: "López",
        phone: "0351 15 400-0001",
        // Each appointment gets a patient of its own, all with the same name.
        confirmDuplicates: true,
      }),
    );
    const service = expectOk(
      await organization.createMedicalService(adminCaller, {
        practitionerId,
        name: "Consulta",
        durationMinutes: 30,
      }),
    );
    const booked = expectOk(
      await organization.bookOverbooking(adminCaller, {
        patientId: registered.patient.id,
        practitionerId,
        medicalServiceId: service.medicalService.id,
        start: new Date("2099-01-05T15:00:00Z"),
        durationMinutes: 30,
        roomId,
        confirmWarnings: true,
      }),
    );
    if (status === "cancelled") {
      expectOk(
        await organization.cancelAppointment(adminCaller, {
          appointmentId: booked.appointment.id,
          cancelledBy: "patient",
          reason: "",
        }),
      );
    }
  }

  it("is refused where another practitioner's appointment fills the room, naming it", async () => {
    const { organization, room, mondayMorning, create } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");
    await storeAppointment(organization, lucia.practitionerId, room.id);

    expect(await create(adminCaller, mondayMorning({ startTime: "11:00" }))).toEqual({
      ok: false,
      reason: "roomFull",
      appointment: {
        practitionerName: "Lucía Díaz",
        roomName: "Consultorio 1",
        date: "2099-01-05",
        startTime: "12:00",
        endTime: "12:30",
      },
    });
  });

  it("is accepted over the practitioner's own appointment, or one cancelled", async () => {
    const { organization, room, juan, mondayMorning, create } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");
    await storeAppointment(organization, lucia.practitionerId, room.id, "cancelled");
    await storeAppointment(organization, juan.practitionerId, room.id);

    expect(await create(adminCaller, mondayMorning({ startTime: "11:00" }))).toMatchObject({
      ok: true,
    });
  });
});

describe("practitioner overlap", () => {
  it("refuses one practitioner in two rooms at once, and accepts a break between", async () => {
    const { organization, mondayMorning, create } = await world();
    const norte = await addOffice(organization, "Sede Norte");
    const elsewhere = await addRoom(organization, norte.id, "Consultorio 2");
    await create(adminCaller, mondayMorning());

    expect(
      await create(
        adminCaller,
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
        adminCaller,
        mondayMorning({ roomId: elsewhere.id, startTime: "14:00", endTime: "18:00" }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("refuses one practitioner in two time zones at once, and accepts them in turn", async () => {
    const { organization, mondayMorning, create } = await world();
    const madrid = await addOffice(organization, "Sede Madrid", "Europe/Madrid");
    const abroad = await addRoom(organization, madrid.id, "Consultorio 2");
    await create(adminCaller, mondayMorning({ lastDate: "2099-02-23" }));
    // Tuesdays never meet Mondays, yet the zones alone refuse the dates in common.
    const tuesday = { roomId: abroad.id, weekdays: [2] };

    expect(await create(adminCaller, mondayMorning(tuesday))).toEqual({
      ok: false,
      reason: "otherTimeZone",
    });
    expect(
      await create(adminCaller, mondayMorning({ ...tuesday, firstDate: "2099-02-24" })),
    ).toMatchObject({ ok: true });
  });

  it("compares the clocks over the dates two schedules share, not from the new one's start", async () => {
    const { organization, mondayMorning, create } = await world();
    // San Luis kept a clock of its own in 2009, and has kept Buenos Aires' since.
    const office = await addOffice(organization, "Sede San Luis", "America/Argentina/San_Luis");
    const sanLuis = await addRoom(organization, office.id, "Consultorio 2");
    await create(adminCaller, mondayMorning({ roomId: sanLuis.id, weekdays: [2] }));

    expect(await create(adminCaller, mondayMorning({ firstDate: "2009-01-05" }))).toMatchObject({
      ok: true,
    });
  });
});

describe("changing a schedule from a date", () => {
  const afternoon = { weekdays: [1], startTime: "14:00", endTime: "18:00", lastDate: null };

  it("ends a started schedule the day before and starts the new fields on the date", async () => {
    const { organization, room, mondayMorning, createdId, schedulesOf } = await world();
    const startedId = await createdId(mondayMorning({ firstDate: "2020-01-06" }));
    const from = shiftDate(today(zone), 7);

    const result = await organization.changeSchedule(adminCaller, {
      scheduleId: startedId,
      from,
      roomId: room.id,
      ...afternoon,
    });

    expect(result).toMatchObject({ ok: true });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        id: startedId,
        startTime: "09:00",
        firstDate: "2020-01-06",
        lastDate: shiftDate(from, -1),
      }),
      expect.objectContaining({ startTime: "14:00", firstDate: from, lastDate: null }),
    ]);
    expect(await auditEntriesFor(organization, startedId)).toEqual([
      expect.objectContaining({ action: "create" }),
      expect.objectContaining({
        action: "update",
        before: { lastDate: null },
        after: { lastDate: shiftDate(from, -1) },
      }),
    ]);
  });

  it("edits a schedule that has not started in place", async () => {
    const { organization, room, juan, mondayMorning, createdId, schedulesOf } = await world();
    const futureId = await createdId(mondayMorning());

    await organization.changeSchedule(juan.caller, {
      scheduleId: futureId,
      from: "2099-01-12",
      roomId: room.id,
      weekdays: [2],
      startTime: "10:00",
      endTime: "14:00",
      lastDate: null,
    });

    expect(await schedulesOf()).toEqual([
      expect.objectContaining({
        id: futureId,
        weekdays: [2],
        startTime: "10:00",
        firstDate: "2099-01-12",
      }),
    ]);
  });

  it("refuses a change that collides, leaving the schedule as it was", async () => {
    const { organization, room, mondayMorning, createdId, createFor, schedulesOf } = await world();
    const startedId = await createdId(mondayMorning({ firstDate: "2020-01-06" }));
    await createFor("Lucía Díaz", { startTime: "14:00", endTime: "18:00" });

    const result = await organization.changeSchedule(adminCaller, {
      scheduleId: startedId,
      from: shiftDate(today(zone), 7),
      roomId: room.id,
      weekdays: [1],
      startTime: "13:00",
      endTime: "15:00",
      lastDate: null,
    });

    expect(result).toMatchObject({ ok: false, reason: "roomFull" });
    expect(await schedulesOf()).toEqual([
      expect.objectContaining({ id: startedId, startTime: "09:00", lastDate: null }),
    ]);
  });

  it("refuses a date in the past, and another practitioner's schedule", async () => {
    const { organization, room, mondayMorning, createdId } = await world();
    const startedId = await createdId(mondayMorning({ firstDate: "2020-01-06" }));
    const lucia = await addStaff(organization, "Lucía Díaz");
    const change = (from: string): ScheduleChange => ({
      scheduleId: startedId,
      from,
      roomId: room.id,
      ...afternoon,
    });

    expect(
      await organization.changeSchedule(adminCaller, change(shiftDate(today(zone), -1))),
    ).toEqual({ ok: false, reason: "dateInPast" });
    expect(
      await organization.changeSchedule(lucia.caller, change(shiftDate(today(zone), 7))),
    ).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("ending and deleting a schedule", () => {
  it("ends a schedule on a date, never earlier than yesterday", async () => {
    const { organization, juan, mondayMorning, createdId, schedulesOf } = await world();
    const startedId = await createdId(mondayMorning({ firstDate: "2020-01-06" }));
    const lastDate = shiftDate(today(zone), 30);

    expect(
      await organization.endSchedule(adminCaller, {
        scheduleId: startedId,
        lastDate: shiftDate(today(zone), -2),
      }),
    ).toEqual({ ok: false, reason: "dateInPast" });
    expect(
      await organization.endSchedule(juan.caller, { scheduleId: startedId, lastDate }),
    ).toEqual({ ok: true });
    expect(await schedulesOf()).toEqual([expect.objectContaining({ lastDate })]);
  });

  it("deletes a schedule before its first date, audited, and refuses once it has started", async () => {
    const { organization, mondayMorning, createdId, schedulesOf } = await world();
    const futureId = await createdId(mondayMorning());
    const startedId = await createdId(
      mondayMorning({ firstDate: "2020-01-06", lastDate: "2020-12-28" }),
    );

    const remove = (scheduleId: string) => organization.deleteSchedule(adminCaller, { scheduleId });

    expect(await remove(startedId)).toEqual({ ok: false, reason: "alreadyStarted" });
    expect(await remove(futureId)).toEqual({ ok: true });
    expect((await schedulesOf()).map((row) => row.id)).toEqual([startedId]);
    expect(await auditEntriesFor(organization, futureId)).toEqual([
      expect.objectContaining({ action: "create" }),
      expect.objectContaining({
        action: "delete",
        before: expect.objectContaining({ firstDate: "2099-01-05", weekdays: "1" }),
        after: null,
      }),
    ]);
  });

  it("refuses a receptionist ending or deleting one", async () => {
    const { organization, mondayMorning, createdId } = await world();
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);
    const scheduleId = await createdId(mondayMorning());

    expect(
      await organization.endSchedule(rosa.caller, { scheduleId, lastDate: "2099-02-01" }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(await organization.deleteSchedule(rosa.caller, { scheduleId })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
