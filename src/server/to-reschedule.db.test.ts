import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { rescheduleAppointment } from "#/server/appointment-reschedule.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { createClosure } from "#/server/closures.ts";
import { setOfficeActive, setRoomActive } from "#/server/offices.ts";
import { endSchedule } from "#/server/schedules.ts";
import { createTimeOff } from "#/server/time-off.ts";
import { setPatientActive } from "#/server/patients.ts";
import { setMemberActive } from "#/server/staff.ts";
import {
  countMemberUpcoming,
  countOfficeUpcoming,
  countPatientUpcoming,
  countRoomUpcoming,
  countToReschedule,
  listToReschedule,
} from "#/server/to-reschedule.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 and 2099-01-12 are Mondays;
// Juan and "Lucía" work there from 09:00 to 11:00 every Monday. The clock is set
// to the first Monday's early morning, before every booking.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanSchedule: { id: string };
let juanService: { id: string };
let luciaService: { id: string };
let maria: { id: string };
let pedro: { id: string };

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("11:00"));
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  juanSchedule = await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanService = await world.addMedicalService(world.juan.id);
  luciaService = await world.addMedicalService(world.lucia.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
  pedro = await world.addPatient("Pedro", "0351 15 555-9876");
});

afterEach(async () => {
  vi.useRealTimers();
  await client.close();
});

async function book(
  start: Date,
  patientId = maria.id,
  practitioner: { id: string } = world.juan,
  serviceId = juanService.id,
  durationMinutes = 30,
) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId,
        practitionerId: practitioner.id,
        medicalServiceId: serviceId,
        start,
        durationMinutes,
        confirmWarnings: true,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment.id;
}

async function listed(actor = world.receptionist) {
  const result = await asAppRole(db, (tx) => listToReschedule(actor, tx));
  if (!result.ok) {
    throw new Error(`listToReschedule failed: ${result.reason}`);
  }
  return result.appointments.map((entry) => ({ id: entry.id, reason: entry.reason }));
}

async function count(actor = world.receptionist) {
  const result = await asAppRole(db, (tx) => countToReschedule(actor, tx));
  if (!result.ok) {
    throw new Error(`countToReschedule failed: ${result.reason}`);
  }
  return result.count;
}

async function addTimeOff(start: string, end: string) {
  const result = await asAppRole(db, (tx) =>
    createTimeOff(
      world.admin,
      { practitionerId: world.juan.id, entry: { kind: "hours", start, end } },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`createTimeOff failed: ${result.reason}`);
  }
}

async function setPractitionerActive(active: boolean, practitioner = world.juan) {
  const result = await asAppRole(db, (tx) =>
    setMemberActive(world.admin, { memberId: practitioner.memberId, active }, tx),
  );
  expect(result.ok).toBe(true);
}

async function setActive(patient: { id: string }, active: boolean) {
  const result = await asAppRole(db, (tx) =>
    setPatientActive(world.admin, { id: patient.id, active }, tx),
  );
  expect(result.ok).toBe(true);
}

async function setPlaceActive(place: { id: string }, active: boolean) {
  const result = await asAppRole(db, (tx) =>
    place === world.office
      ? setOfficeActive(world.admin, { id: place.id, active }, tx)
      : setRoomActive(world.admin, { id: place.id, active }, tx),
  );
  expect(result.ok).toBe(true);
}

/** Juan's Mondays move to a new room of the office from the second Monday on. */
async function moveJuanToNewRoom() {
  const ended = await asAppRole(db, (tx) =>
    endSchedule(world.admin, { scheduleId: juanSchedule.id, lastDate: "2099-01-05" }, tx),
  );
  expect(ended.ok).toBe(true);
  const newRoom = await world.addRoom(world.office.id, "Consultorio 3");
  await world.addSchedule({
    practitionerId: world.juan.id,
    roomId: newRoom.id,
    firstDate: "2099-01-12",
  });
  return newRoom;
}

async function overbook(start: Date, patientId = maria.id) {
  const result = await asAppRole(db, (tx) =>
    bookOverbooking(
      world.receptionist,
      {
        patientId,
        practitionerId: world.juan.id,
        medicalServiceId: juanService.id,
        start,
        durationMinutes: 30,
        roomId: world.room.id,
        confirmWarnings: true,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookOverbooking failed: ${result.reason}`);
  }
  return result.appointment.id;
}

async function addClosure(officeId: string | null, date: string) {
  const result = await asAppRole(db, (tx) =>
    createClosure(
      world.admin,
      { officeId, entry: { kind: "days", firstDate: date, lastDate: date } },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`createClosure failed: ${result.reason}`);
  }
}

describe("the to-reschedule list", () => {
  it("is empty while every appointment is inside working time", async () => {
    await book(at("12:00"));
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    expect(await listed()).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("reaches a closure past the last start, during a longer earlier appointment", async () => {
    const tuesday = "2099-01-06";
    await world.addSchedule({ practitionerId: world.juan.id, weekdays: [2], endTime: "12:00" });
    await world.addSchedule({
      practitionerId: world.lucia.id,
      roomId: world.otherRoom.id,
      weekdays: [2],
    });
    const long = await book(at("12:00", tuesday), maria.id, world.juan, juanService.id, 180);
    await book(at("13:00", tuesday), pedro.id, world.lucia, luciaService.id);

    await asAppRole(db, (tx) =>
      createClosure(
        world.admin,
        {
          officeId: world.office.id,
          entry: { kind: "hours", start: `${tuesday}T11:00`, end: `${tuesday}T12:00` },
        },
        tx,
      ),
    );

    expect(await listed()).toEqual([{ id: long, reason: "closure" }]);
  });

  it("takes the appointments that new time off overlaps, and only those", async () => {
    const overlapped = await book(at("12:30"));
    await book(at("13:00"), pedro.id);
    await book(at("12:30"), pedro.id, world.lucia, luciaService.id);

    await addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expect(await listed()).toEqual([{ id: overlapped, reason: "timeOff" }]);
    expect(await count()).toBe(1);
  });

  it("takes the appointments in an office's closure, and in the organization's", async () => {
    const firstMonday = await book(at("12:00"));
    const lucias = await book(at("12:00"), pedro.id, world.lucia, luciaService.id);
    const secondMonday = await book(at("12:00", "2099-01-12"));

    await addClosure(world.office.id, "2099-01-05");
    expect(await listed()).toEqual([
      { id: firstMonday, reason: "closure" },
      { id: lucias, reason: "closure" },
    ]);

    await addClosure(null, "2099-01-12");
    expect(await count()).toBe(3);
    expect((await listed()).map((entry) => entry.id)).toContain(secondMonday);
  });

  it("takes the appointments after a schedule ended early", async () => {
    await book(at("12:00"));
    const nextWeek = await book(at("12:00", "2099-01-12"));

    const ended = await asAppRole(db, (tx) =>
      endSchedule(world.admin, { scheduleId: juanSchedule.id, lastDate: "2099-01-05" }, tx),
    );

    expect(ended.ok).toBe(true);
    expect(await listed()).toEqual([{ id: nextWeek, reason: "outsideSchedules" }]);
  });

  it("never lists an overbooking, even in time off", async () => {
    await overbook(at("15:00"));
    await addTimeOff("2099-01-05T12:00", "2099-01-05T13:00");

    expect(await listed()).toEqual([]);
  });

  it("lists confirmed appointments too, and drops them once checked in or past", async () => {
    const confirmed = await book(at("12:00"));
    const checkedIn = await book(at("12:30"), pedro.id);
    for (const [id, status] of [
      [confirmed, "confirmed"],
      [checkedIn, "checkedIn"],
    ] as const) {
      const changed = await asAppRole(db, (tx) =>
        changeAppointmentStatus(world.receptionist, { appointmentId: id, status }, tx),
      );
      expect(changed.ok).toBe(true);
    }
    await addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expect(await listed()).toEqual([{ id: confirmed, reason: "timeOff" }]);

    vi.setSystemTime(at("12:10"));
    expect(await listed()).toEqual([]);
  });

  it("drops an appointment once it is cancelled", async () => {
    const id = await book(at("12:00"));
    await addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    await asAppRole(db, (tx) =>
      cancelAppointment(
        world.receptionist,
        { appointmentId: id, cancelledBy: "business", reason: null },
        tx,
      ),
    );

    expect(await listed()).toEqual([]);
  });

  it("drops an appointment once it is moved to working time", async () => {
    const id = await book(at("12:00"));
    await addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    const moved = await asAppRole(db, (tx) =>
      rescheduleAppointment(
        world.receptionist,
        { appointmentId: id, start: at("13:30"), durationMinutes: 30 },
        tx,
      ),
    );

    expect(moved.ok).toBe(true);
    expect(await listed()).toEqual([]);
  });

  it("shows a practitioner only their own appointments", async () => {
    const juans = await book(at("12:00"));
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);
    await addClosure(world.office.id, "2099-01-05");

    expect(await listed(world.juan.actor)).toEqual([{ id: juans, reason: "closure" }]);
    expect(await count(world.juan.actor)).toBe(1);
  });

  it("names the patient, the practitioner and the place, for reception to call", async () => {
    await book(at("12:00"));
    await addClosure(world.office.id, "2099-01-05");

    const result = await asAppRole(db, (tx) => listToReschedule(world.receptionist, tx));

    expect(result.ok && result.appointments[0]).toMatchObject({
      patientName: "María Paz",
      practitioner: { id: world.juan.id, displayName: "Juan Gómez" },
      officeName: "Sede Centro",
      roomName: "Consultorio 1",
      start: at("12:00"),
      end: at("12:30"),
      status: "booked",
    });
  });
});

describe("deactivated people on the to-reschedule list", () => {
  it("takes a deactivated practitioner's future appointments, overbookings too", async () => {
    const inside = await book(at("12:00"));
    const overbooked = await overbook(at("15:00"), pedro.id);
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    await setPractitionerActive(false);

    expect(await listed()).toEqual([
      { id: inside, reason: "practitionerInactive" },
      { id: overbooked, reason: "practitionerInactive" },
    ]);
    expect(await count()).toBe(2);
  });

  it("takes a deactivated patient's future appointments, overbookings too", async () => {
    const inside = await book(at("12:00"));
    const overbooked = await overbook(at("15:00"));
    await book(at("12:30"), pedro.id);

    await setActive(maria, false);

    expect(await listed()).toEqual([
      { id: inside, reason: "patientInactive" },
      { id: overbooked, reason: "patientInactive" },
    ]);
  });

  it("names the practitioner when both are deactivated", async () => {
    const id = await book(at("12:00"));

    await setActive(maria, false);
    await setPractitionerActive(false);

    expect(await listed()).toEqual([{ id, reason: "practitionerInactive" }]);
  });

  it("drops an appointment of someone deactivated once it is cancelled", async () => {
    const id = await book(at("12:00"));
    await setPractitionerActive(false);

    const result = await asAppRole(db, (tx) =>
      cancelAppointment(
        world.receptionist,
        { appointmentId: id, cancelledBy: "business", reason: "" },
        tx,
      ),
    );

    expect(result.ok).toBe(true);
    expect(await listed()).toEqual([]);
  });

  it("gives the appointments back on reactivation", async () => {
    await book(at("12:00"));
    await setActive(maria, false);
    await setPractitionerActive(false);

    await setActive(maria, true);
    await setPractitionerActive(true);

    expect(await listed()).toEqual([]);
  });
});

describe("deactivated places on the to-reschedule list", () => {
  it("takes the future appointments in a deactivated room, overbookings too", async () => {
    const inside = await book(at("12:00"));
    const overbooked = await overbook(at("15:00"), pedro.id);
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    await setPlaceActive(world.room, false);

    expect(await listed()).toEqual([
      { id: inside, reason: "roomInactive" },
      { id: overbooked, reason: "roomInactive" },
    ]);
  });

  it("takes an appointment in the room even when another room's schedule covers it", async () => {
    const id = await book(at("12:00", "2099-01-12"));
    await moveJuanToNewRoom();
    expect(await listed()).toEqual([]);

    await setPlaceActive(world.room, false);

    expect(await listed()).toEqual([{ id, reason: "roomInactive" }]);
  });

  it("names the office when both are deactivated, and a person before either", async () => {
    const id = await book(at("12:00"));

    await setPlaceActive(world.room, false);
    await setPlaceActive(world.office, false);
    expect(await listed()).toEqual([{ id, reason: "officeInactive" }]);

    await setActive(maria, false);
    expect(await listed()).toEqual([{ id, reason: "patientInactive" }]);
  });

  it("drops an appointment moved out of the room", async () => {
    const id = await book(at("12:00", "2099-01-12"));
    await moveJuanToNewRoom();
    await setPlaceActive(world.room, false);

    const moved = await asAppRole(db, (tx) =>
      rescheduleAppointment(
        world.receptionist,
        { appointmentId: id, start: at("13:30", "2099-01-12"), durationMinutes: 30 },
        tx,
      ),
    );

    expect(moved.ok).toBe(true);
    expect(await listed()).toEqual([]);
  });

  it("gives the appointments back on reactivation", async () => {
    await book(at("12:00"));
    await setPlaceActive(world.office, false);

    await setPlaceActive(world.office, true);

    expect(await listed()).toEqual([]);
  });
});

describe("the future appointments a deactivation would send to the list", () => {
  async function patientCount(patient: { id: string }, actor = world.admin) {
    return asAppRole(db, (tx) => countPatientUpcoming(actor, { id: patient.id }, tx));
  }

  async function memberCount(memberId: string, actor = world.admin) {
    return asAppRole(db, (tx) => countMemberUpcoming(actor, { memberId }, tx));
  }

  it("counts a patient's booked and confirmed future ones, overbookings too", async () => {
    await book(at("12:00"));
    await overbook(at("15:00"));
    await book(at("12:30"), pedro.id);
    const cancelled = await book(at("13:00"));
    const result = await asAppRole(db, (tx) =>
      cancelAppointment(
        world.receptionist,
        { appointmentId: cancelled, cancelledBy: "patient", reason: "" },
        tx,
      ),
    );
    expect(result.ok).toBe(true);

    expect(await patientCount(maria)).toEqual({ ok: true, count: 2 });
    expect(await patientCount(pedro)).toEqual({ ok: true, count: 1 });
  });

  it("counts a member's as a practitioner, and none for a member without any", async () => {
    await book(at("12:00"));
    await book(at("12:30"), pedro.id);
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    expect(await memberCount(world.juan.memberId)).toEqual({ ok: true, count: 2 });
    expect(await memberCount("no-such-member")).toEqual({ ok: true, count: 0 });
  });

  it("leaves past appointments out", async () => {
    await book(at("12:00"));

    vi.setSystemTime(at("13:00"));

    expect(await patientCount(maria)).toEqual({ ok: true, count: 0 });
  });

  it("refuses a malformed id", async () => {
    expect(await patientCount({ id: "not-a-uuid" })).toEqual({ ok: false, reason: "invalidInput" });
    expect(await memberCount("")).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("is for admins only, who alone deactivate", async () => {
    expect(await patientCount(maria, world.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await memberCount(world.juan.memberId, world.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("the future appointments deactivating a room or an office would send to the list", () => {
  function roomCount(room: { id: string }, actor = world.admin) {
    return asAppRole(db, (tx) => countRoomUpcoming(actor, { id: room.id }, tx));
  }

  function officeCount(office: { id: string }, actor = world.admin) {
    return asAppRole(db, (tx) => countOfficeUpcoming(actor, { id: office.id }, tx));
  }

  it("counts the appointments in that room, overbookings too", async () => {
    await book(at("12:00"));
    await overbook(at("15:00"), pedro.id);
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    expect(await roomCount(world.room)).toEqual({ ok: true, count: 2 });
    expect(await roomCount(world.otherRoom)).toEqual({ ok: true, count: 1 });
  });

  it("leaves out what is on the list already", async () => {
    await book(at("12:00"));
    await addTimeOff("2099-01-05T09:00", "2099-01-05T09:30");

    expect(await roomCount(world.room)).toEqual({ ok: true, count: 0 });
  });

  it("counts an appointment in the room that another room's schedule covers", async () => {
    await book(at("12:00", "2099-01-12"));
    await moveJuanToNewRoom();

    expect(await roomCount(world.room)).toEqual({ ok: true, count: 1 });
  });

  it("counts an appointment elsewhere that only that room's schedule covers", async () => {
    const id = await book(at("12:00", "2099-01-12"));
    const newRoom = await moveJuanToNewRoom();

    expect(await roomCount(newRoom)).toEqual({ ok: true, count: 1 });

    await setPlaceActive(newRoom, false);
    expect(await listed()).toEqual([{ id, reason: "outsideSchedules" }]);
  });

  it("counts every room of an office", async () => {
    await book(at("12:00"));
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    expect(await officeCount(world.office)).toEqual({ ok: true, count: 2 });
  });

  it("matches what deactivating the office adds to the list", async () => {
    await book(at("12:00"));
    await overbook(at("15:00"), pedro.id);
    await book(at("12:00"), pedro.id, world.lucia, luciaService.id);

    const before = await officeCount(world.office);
    await setPlaceActive(world.office, false);

    expect(before).toEqual({ ok: true, count: await count() });
  });

  it("refuses a malformed id, and anyone but an admin", async () => {
    expect(await roomCount({ id: "not-a-uuid" })).toEqual({ ok: false, reason: "invalidInput" });
    expect(await officeCount({ id: "not-a-uuid" })).toEqual({ ok: false, reason: "invalidInput" });
    expect(await roomCount(world.room, world.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await officeCount(world.office, world.receptionist)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
