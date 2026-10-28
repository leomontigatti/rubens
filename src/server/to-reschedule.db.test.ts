import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { rescheduleAppointment } from "#/server/appointment-reschedule.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/server/appointments.test-support.ts";
import type { BookingWorld } from "#/server/appointments.test-support.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { createClosure } from "#/server/closures.ts";
import { endSchedule } from "#/server/schedules.ts";
import { createTimeOff } from "#/server/time-off.ts";
import { countToReschedule, listToReschedule } from "#/server/to-reschedule.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 and 2099-01-12 are Mondays;
// Juan and "Lucía" work there from 09:00 to 11:00 every Monday. The clock is set
// to the first Monday's early morning, before every booking.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanSchedule: { id: string };
let juanType: { id: string };
let luciaType: { id: string };
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
  juanType = await world.addType(world.juan.id);
  luciaType = await world.addType(world.lucia.id);
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
  typeId = juanType.id,
) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId,
        practitionerId: practitioner.id,
        appointmentTypeId: typeId,
        start,
        durationMinutes: 30,
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
    await book(at("12:00"), pedro.id, world.lucia, luciaType.id);

    expect(await listed()).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("takes the appointments that new time off overlaps, and only those", async () => {
    const overlapped = await book(at("12:30"));
    await book(at("13:00"), pedro.id);
    await book(at("12:30"), pedro.id, world.lucia, luciaType.id);

    await addTimeOff("2099-01-05T09:00", "2099-01-05T10:00");

    expect(await listed()).toEqual([{ id: overlapped, reason: "timeOff" }]);
    expect(await count()).toBe(1);
  });

  it("takes the appointments in an office's closure, and in the organization's", async () => {
    const firstMonday = await book(at("12:00"));
    const lucias = await book(at("12:00"), pedro.id, world.lucia, luciaType.id);
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
    const result = await asAppRole(db, (tx) =>
      bookOverbooking(
        world.receptionist,
        {
          patientId: maria.id,
          practitionerId: world.juan.id,
          appointmentTypeId: juanType.id,
          start: at("15:00"),
          durationMinutes: 30,
          roomId: world.room.id,
        },
        tx,
      ),
    );
    expect(result.ok).toBe(true);
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
    await book(at("12:00"), pedro.id, world.lucia, luciaType.id);
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
