import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addRoom,
  adminCaller,
  at,
  expectOk,
  fakeAccounts,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

vi.mock(import("#/organization/accounts.ts"), async (original) => ({
  ...(await original()),
  accountsFor: () => fakeAccounts,
}));

// The office is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05
// and 2099-01-12 are Mondays; Juan and "Lucía" work there from 09:00 to 11:00
// every Monday. The clock is set to the first Monday's early morning, before
// every booking.

type Caller = typeof adminCaller;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("11:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function world() {
  const booking = await setUpBookingWorld();
  const { organization, juan, lucia, receptionist, room, otherRoom, office } = booking;
  const juanSchedule = await booking.addSchedule({ practitionerId: juan.practitionerId });
  await booking.addSchedule({ practitionerId: lucia.practitionerId, roomId: otherRoom.id });
  const juanService = await booking.addMedicalService(juan.practitionerId);
  const luciaService = await booking.addMedicalService(lucia.practitionerId);
  const maria = await booking.addPatient("María", "0351 15 555-1234");
  const pedro = await booking.addPatient("Pedro", "0351 15 555-9876");

  async function book(
    start: Date,
    patientId = maria.id,
    who: "juan" | "lucia" = "juan",
    durationMinutes = 30,
  ) {
    const created = await booking.book({
      patientId,
      practitionerId: booking[who].practitionerId,
      medicalServiceId: who === "juan" ? juanService.id : luciaService.id,
      start,
      durationMinutes,
      confirmWarnings: true,
    });
    return created.id;
  }

  async function overbook(start: Date, patientId = maria.id) {
    const created = await booking.overbook({
      patientId,
      practitionerId: juan.practitionerId,
      medicalServiceId: juanService.id,
      start,
      durationMinutes: 30,
      roomId: room.id,
      confirmWarnings: true,
    });
    return created.id;
  }

  async function listed(caller: Caller = receptionist) {
    const result = expectOk(await organization.listToReschedule(caller));
    return result.appointments.map((entry) => ({ id: entry.id, reason: entry.reason }));
  }

  async function count(caller: Caller = receptionist) {
    return expectOk(await organization.countToReschedule(caller)).count;
  }

  async function addTimeOff(start: string, end: string) {
    expectOk(
      await organization.createTimeOff(adminCaller, {
        practitionerId: juan.practitionerId,
        entry: { kind: "hours", start, end },
      }),
    );
  }

  async function addClosure(officeId: string | null, date: string) {
    expectOk(
      await organization.createClosure(adminCaller, {
        officeId,
        entry: { kind: "days", firstDate: date, lastDate: date },
      }),
    );
  }

  async function setPractitionerActive(active: boolean, who: "juan" | "lucia" = "juan") {
    expectOk(
      await organization.setMemberActive(adminCaller, {
        memberId: booking[who].caller.userId,
        active,
      }),
    );
  }

  async function setPatientActive(patient: { id: string }, active: boolean) {
    expectOk(await organization.setPatientActive(adminCaller, { id: patient.id, active }));
  }

  async function setPlaceActive(place: { id: string }, active: boolean) {
    expectOk(
      place.id === office.id
        ? await organization.setOfficeActive(adminCaller, { id: place.id, active })
        : await organization.setRoomActive(adminCaller, { id: place.id, active }),
    );
  }

  /** Juan's Mondays move to a new room of the office from the second Monday on. */
  async function moveJuanToNewRoom() {
    expectOk(
      await organization.endSchedule(adminCaller, {
        scheduleId: juanSchedule.id,
        lastDate: "2099-01-05",
      }),
    );
    const newRoom = await addRoom(organization, office.id, "Consultorio 3");
    await booking.addSchedule({
      practitionerId: juan.practitionerId,
      roomId: newRoom.id,
      firstDate: "2099-01-12",
    });
    return newRoom;
  }

  return {
    ...booking,
    juanSchedule,
    maria,
    pedro,
    book,
    overbook,
    listed,
    count,
    addTimeOff,
    addClosure,
    setPractitionerActive,
    setPatientActive,
    setPlaceActive,
    moveJuanToNewRoom,
  };
}

describe("the to-reschedule list", () => {
  it("is empty while every appointment is inside working time", async () => {
    const w = await world();
    await w.book(at("12:00"));
    await w.book(at("12:00"), w.pedro.id, "lucia");

    expect(await w.listed()).toEqual([]);
    expect(await w.count()).toBe(0);
  });

  it("reaches a closure past the last start, during a longer earlier appointment", async () => {
    const w = await world();
    const tuesday = "2099-01-06";
    await w.addSchedule({ practitionerId: w.juan.practitionerId, weekdays: [2], endTime: "12:00" });
    await w.addSchedule({
      practitionerId: w.lucia.practitionerId,
      roomId: w.otherRoom.id,
      weekdays: [2],
    });
    const long = await w.book(at("12:00", tuesday), w.maria.id, "juan", 180);
    await w.book(at("13:00", tuesday), w.pedro.id, "lucia");

    expectOk(
      await w.organization.createClosure(adminCaller, {
        officeId: w.office.id,
        entry: { kind: "hours", start: `${tuesday}T11:00`, end: `${tuesday}T12:00` },
      }),
    );

    expect(await w.listed()).toEqual([{ id: long, reason: "closure" }]);
  });

  it("takes the appointments that new time off overlaps, and only those", async () => {
    const w = await world();
    const overlapped = await w.book(at("12:30"));
    await w.book(at("13:00"), w.pedro.id);
    await w.book(at("12:30"), w.pedro.id, "lucia");

    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expect(await w.listed()).toEqual([{ id: overlapped, reason: "timeOff" }]);
    expect(await w.count()).toBe(1);
  });

  it("takes the appointments in an office's closure, and in the organization's", async () => {
    const w = await world();
    const firstMonday = await w.book(at("12:00"));
    const lucias = await w.book(at("12:00"), w.pedro.id, "lucia");
    const secondMonday = await w.book(at("12:00", "2099-01-12"));

    await w.addClosure(w.office.id, "2099-01-05");
    expect(await w.listed()).toEqual(
      [
        { id: firstMonday, reason: "closure" },
        { id: lucias, reason: "closure" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );

    await w.addClosure(null, "2099-01-12");
    expect(await w.count()).toBe(3);
    expect((await w.listed()).map((entry) => entry.id)).toContain(secondMonday);
  });

  it("takes the appointments after a schedule ended early", async () => {
    const w = await world();
    await w.book(at("12:00"));
    const nextWeek = await w.book(at("12:00", "2099-01-12"));

    expectOk(
      await w.organization.endSchedule(adminCaller, {
        scheduleId: w.juanSchedule.id,
        lastDate: "2099-01-05",
      }),
    );

    expect(await w.listed()).toEqual([{ id: nextWeek, reason: "outsideSchedules" }]);
  });

  it("never lists an overbooking, even in time off", async () => {
    const w = await world();
    await w.overbook(at("15:00"));
    await w.addTimeOff("2099-01-05T12:00", "2099-01-05T13:00");

    expect(await w.listed()).toEqual([]);
    expect(await w.count()).toBe(0);
  });

  it("lists confirmed appointments too, and drops them once checked in or past", async () => {
    const w = await world();
    const confirmed = await w.book(at("12:00"));
    const checkedIn = await w.book(at("12:30"), w.pedro.id);
    for (const [appointmentId, status] of [
      [confirmed, "confirmed"],
      [checkedIn, "checkedIn"],
    ] as const) {
      expectOk(
        await w.organization.changeAppointmentStatus(w.receptionist, { appointmentId, status }),
      );
    }
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expect(await w.listed()).toEqual([{ id: confirmed, reason: "timeOff" }]);

    vi.setSystemTime(at("12:10"));
    expect(await w.listed()).toEqual([]);
  });

  it("drops an appointment once it is cancelled, and never cancels one itself", async () => {
    const w = await world();
    const id = await w.book(at("12:00"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");
    expect(await w.appointmentOf(id)).toMatchObject({ status: "booked" });

    expectOk(
      await w.organization.cancelAppointment(w.receptionist, {
        appointmentId: id,
        cancelledBy: "business",
        reason: null,
      }),
    );

    expect(await w.listed()).toEqual([]);
  });

  it("drops an appointment once it is moved to working time", async () => {
    const w = await world();
    const id = await w.book(at("12:00"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expectOk(
      await w.organization.rescheduleAppointment(w.receptionist, {
        appointmentId: id,
        start: at("13:30"),
        durationMinutes: 30,
      }),
    );

    expect(await w.listed()).toEqual([]);
  });

  it("shows a practitioner only their own appointments", async () => {
    const w = await world();
    const juans = await w.book(at("12:00"));
    await w.book(at("12:00"), w.pedro.id, "lucia");
    await w.addClosure(w.office.id, "2099-01-05");

    expect(await w.listed(w.juan.caller)).toEqual([{ id: juans, reason: "closure" }]);
    expect(await w.count(w.juan.caller)).toBe(1);
  });

  it("names the patient, the practitioner and the place, for reception to call", async () => {
    const w = await world();
    await w.book(at("12:00"));
    await w.addClosure(w.office.id, "2099-01-05");

    const result = expectOk(await w.organization.listToReschedule(w.receptionist));

    expect(result.appointments[0]).toMatchObject({
      patientName: "María Paz",
      practitioner: { id: w.juan.practitionerId, displayName: "Juan Gómez" },
      officeName: "Sede Centro",
      roomName: "Consultorio 1",
      start: at("12:00"),
      end: at("12:30"),
      status: "booked",
    });
  });
});

describe("the menu's count of the to-reschedule list", () => {
  it("counts what the list holds, for every reason, and for a practitioner their own", async () => {
    const w = await world();
    await w.book(at("12:00"));
    await w.book(at("12:30"), w.pedro.id);
    await w.overbook(at("15:00"));
    await w.book(at("12:00"), w.pedro.id, "lucia");
    await w.book(at("12:00", "2099-01-12"));
    await w.addTimeOff("2099-01-05T09:30", "2099-01-05T10:00");
    await w.addClosure(w.office.id, "2099-01-12");
    await w.setPractitionerActive(false, "lucia");

    expect((await w.listed()).map((entry) => entry.reason).sort()).toEqual([
      "closure",
      "practitionerInactive",
      "timeOff",
    ]);
    expect(await w.count()).toBe(3);
    expect(await w.listed(w.juan.caller)).toHaveLength(2);
    expect(await w.count(w.juan.caller)).toBe(2);
  });
});

describe("deactivated people on the to-reschedule list", () => {
  it("takes a deactivated practitioner's future appointments, overbookings too", async () => {
    const w = await world();
    const inside = await w.book(at("12:00"));
    const overbooked = await w.overbook(at("15:00"), w.pedro.id);
    await w.book(at("12:00"), w.pedro.id, "lucia");

    await w.setPractitionerActive(false);

    expect(await w.listed()).toEqual([
      { id: inside, reason: "practitionerInactive" },
      { id: overbooked, reason: "practitionerInactive" },
    ]);
    expect(await w.count()).toBe(2);
  });

  it("takes a deactivated patient's future appointments, overbookings too", async () => {
    const w = await world();
    const inside = await w.book(at("12:00"));
    const overbooked = await w.overbook(at("15:00"));
    await w.book(at("12:30"), w.pedro.id);

    await w.setPatientActive(w.maria, false);

    expect(await w.listed()).toEqual([
      { id: inside, reason: "patientInactive" },
      { id: overbooked, reason: "patientInactive" },
    ]);
  });

  it("names the practitioner when both are deactivated", async () => {
    const w = await world();
    const id = await w.book(at("12:00"));

    await w.setPatientActive(w.maria, false);
    await w.setPractitionerActive(false);

    expect(await w.listed()).toEqual([{ id, reason: "practitionerInactive" }]);
  });

  it("drops an appointment of someone deactivated once it is cancelled", async () => {
    const w = await world();
    const id = await w.book(at("12:00"));
    await w.setPractitionerActive(false);

    expectOk(
      await w.organization.cancelAppointment(w.receptionist, {
        appointmentId: id,
        cancelledBy: "business",
        reason: "",
      }),
    );

    expect(await w.listed()).toEqual([]);
  });

  it("gives the appointments back on reactivation", async () => {
    const w = await world();
    await w.book(at("12:00"));
    await w.setPatientActive(w.maria, false);
    await w.setPractitionerActive(false);

    await w.setPatientActive(w.maria, true);
    await w.setPractitionerActive(true);

    expect(await w.listed()).toEqual([]);
  });
});

describe("deactivated places on the to-reschedule list", () => {
  it("takes the future appointments in a deactivated room, overbookings too", async () => {
    const w = await world();
    const inside = await w.book(at("12:00"));
    const overbooked = await w.overbook(at("15:00"), w.pedro.id);
    await w.book(at("12:00"), w.pedro.id, "lucia");

    await w.setPlaceActive(w.room, false);

    expect(await w.listed()).toEqual([
      { id: inside, reason: "roomInactive" },
      { id: overbooked, reason: "roomInactive" },
    ]);
  });

  it("takes an appointment in the room even when another room's schedule covers it", async () => {
    const w = await world();
    const id = await w.book(at("12:00", "2099-01-12"));
    await w.moveJuanToNewRoom();
    expect(await w.listed()).toEqual([]);

    await w.setPlaceActive(w.room, false);

    expect(await w.listed()).toEqual([{ id, reason: "roomInactive" }]);
  });

  it("names the office when both are deactivated, and a person before either", async () => {
    const w = await world();
    const id = await w.book(at("12:00"));

    await w.setPlaceActive(w.room, false);
    await w.setPlaceActive(w.office, false);
    expect(await w.listed()).toEqual([{ id, reason: "officeInactive" }]);

    await w.setPatientActive(w.maria, false);
    expect(await w.listed()).toEqual([{ id, reason: "patientInactive" }]);
  });

  it("drops an appointment moved out of the room", async () => {
    const w = await world();
    const id = await w.book(at("12:00", "2099-01-12"));
    await w.moveJuanToNewRoom();
    await w.setPlaceActive(w.room, false);

    expectOk(
      await w.organization.rescheduleAppointment(w.receptionist, {
        appointmentId: id,
        start: at("13:30", "2099-01-12"),
        durationMinutes: 30,
      }),
    );

    expect(await w.listed()).toEqual([]);
  });

  it("gives the appointments back on reactivation", async () => {
    const w = await world();
    await w.book(at("12:00"));
    await w.setPlaceActive(w.office, false);

    await w.setPlaceActive(w.office, true);

    expect(await w.listed()).toEqual([]);
  });
});

describe("the future appointments a deactivation would send to the list", () => {
  async function countWorld() {
    const w = await world();
    const patientCount = (patient: { id: string }, caller: Caller = adminCaller) =>
      w.organization.countPatientUpcoming(caller, { id: patient.id });
    const memberCount = (memberId: string, caller: Caller = adminCaller) =>
      w.organization.countMemberUpcoming(caller, { memberId });
    return { ...w, patientCount, memberCount };
  }

  it("counts a patient's booked and confirmed future ones, overbookings too", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.overbook(at("15:00"));
    await w.book(at("12:30"), w.pedro.id);
    const cancelled = await w.book(at("13:00"));
    expectOk(
      await w.organization.cancelAppointment(w.receptionist, {
        appointmentId: cancelled,
        cancelledBy: "patient",
        reason: "",
      }),
    );

    expect(await w.patientCount(w.maria)).toEqual({ ok: true, count: 2 });
    expect(await w.patientCount(w.pedro)).toEqual({ ok: true, count: 1 });
  });

  it("counts a member's as a practitioner, and none for a member without any", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.book(at("12:30"), w.pedro.id);
    await w.book(at("12:00"), w.pedro.id, "lucia");

    expect(await w.memberCount(w.juan.caller.userId)).toEqual({ ok: true, count: 2 });
    expect(await w.memberCount("no-such-member")).toEqual({ ok: true, count: 0 });
  });

  it("leaves out what is on the list already", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.book(at("12:30"), w.pedro.id);
    await w.book(at("13:30"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    expect(await w.patientCount(w.maria)).toEqual({ ok: true, count: 1 });
    expect(await w.memberCount(w.juan.caller.userId)).toEqual({ ok: true, count: 2 });
  });

  it("matches what deactivating the patient adds to the list", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.book(at("13:30"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    const before = await w.count();
    const predicted = await w.patientCount(w.maria);
    await w.setPatientActive(w.maria, false);

    expect(predicted).toEqual({ ok: true, count: (await w.count()) - before });
  });

  it("matches what deactivating the practitioner adds to the list", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.overbook(at("15:00"), w.pedro.id);
    await w.book(at("13:30"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    const before = await w.count();
    const predicted = await w.memberCount(w.juan.caller.userId);
    await w.setPractitionerActive(false);

    expect(predicted).toEqual({ ok: true, count: (await w.count()) - before });
  });

  it("leaves past appointments out", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));

    vi.setSystemTime(at("13:00"));

    expect(await w.patientCount(w.maria)).toEqual({ ok: true, count: 0 });
  });

  it("refuses a malformed id", async () => {
    const w = await countWorld();

    expect(await w.patientCount({ id: "not-a-uuid" })).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(await w.memberCount("")).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("is for admins only, who alone deactivate", async () => {
    const w = await countWorld();

    expect(await w.patientCount(w.maria, w.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await w.memberCount(w.juan.caller.userId, w.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("the future appointments deactivating a room or an office would send to the list", () => {
  async function countWorld() {
    const w = await world();
    const roomCount = (room: { id: string }, caller: Caller = adminCaller) =>
      w.organization.countRoomUpcoming(caller, { id: room.id });
    const officeCount = (office: { id: string }, caller: Caller = adminCaller) =>
      w.organization.countOfficeUpcoming(caller, { id: office.id });
    return { ...w, roomCount, officeCount };
  }

  it("counts the appointments in that room, overbookings too", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.overbook(at("15:00"), w.pedro.id);
    await w.book(at("12:00"), w.pedro.id, "lucia");

    expect(await w.roomCount(w.room)).toEqual({ ok: true, count: 2 });
    expect(await w.roomCount(w.otherRoom)).toEqual({ ok: true, count: 1 });
  });

  it("leaves out what is on the list already", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    expect(await w.roomCount(w.room)).toEqual({ ok: true, count: 0 });
  });

  it("counts an appointment in the room that another room's schedule covers", async () => {
    const w = await countWorld();
    await w.book(at("12:00", "2099-01-12"));
    await w.moveJuanToNewRoom();

    expect(await w.roomCount(w.room)).toEqual({ ok: true, count: 1 });
  });

  it("counts an appointment elsewhere that only that room's schedule covers", async () => {
    const w = await countWorld();
    const id = await w.book(at("12:00", "2099-01-12"));
    const newRoom = await w.moveJuanToNewRoom();

    expect(await w.roomCount(newRoom)).toEqual({ ok: true, count: 1 });

    await w.setPlaceActive(newRoom, false);
    expect(await w.listed()).toEqual([{ id, reason: "outsideSchedules" }]);
  });

  it("counts every room of an office", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.book(at("12:00"), w.pedro.id, "lucia");

    expect(await w.officeCount(w.office)).toEqual({ ok: true, count: 2 });
  });

  it("matches what deactivating the office adds to the list", async () => {
    const w = await countWorld();
    await w.book(at("12:00"));
    await w.overbook(at("15:00"), w.pedro.id);
    await w.book(at("12:00"), w.pedro.id, "lucia");
    await w.addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    const before = await w.count();
    const predicted = await w.officeCount(w.office);
    await w.setPlaceActive(w.office, false);

    expect(before).toBe(1);
    expect(predicted).toEqual({ ok: true, count: (await w.count()) - before });
  });

  it("refuses a malformed id, and anyone but an admin", async () => {
    const w = await countWorld();

    expect(await w.roomCount({ id: "not-a-uuid" })).toEqual({ ok: false, reason: "invalidInput" });
    expect(await w.officeCount({ id: "not-a-uuid" })).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(await w.roomCount(w.room, w.receptionist)).toEqual({ ok: false, reason: "forbidden" });
    expect(await w.officeCount(w.office, w.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
