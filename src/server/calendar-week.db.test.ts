import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, medicalService, practitioner } from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import type { BookingInput, CalendarWeekQuery } from "#/lib/appointments.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/server/appointment-statuses.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getCalendarWeek } from "#/server/calendar-week.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday. Juan and
// `Lucía` both work Mondays 09:00 to 11:00 in "Consultorio doble", a room for two.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let shared: { id: string };
let juanService: { id: string };
let juanLongService: { id: string };
let luciaService: { id: string };
let maria: { id: string };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  shared = await world.addRoom(world.office.id, "Consultorio doble", 2);
  await world.addSchedule({ practitionerId: world.juan.id, roomId: shared.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: shared.id });
  juanService = await world.addMedicalService(world.juan.id);
  juanLongService = await world.addMedicalService(world.juan.id, 60);
  luciaService = await world.addMedicalService(world.lucia.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
});

afterEach(async () => {
  await client.close();
});

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

async function book(overrides: Partial<BookingInput> = {}) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        medicalServiceId: juanService.id,
        start: at("12:00"),
        durationMinutes: 30,
        receptionNote: "Trae estudios",
        ...overrides,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment;
}

async function overbook(overrides: Partial<BookingInput> & { roomId?: string } = {}) {
  const result = await asAppRole(db, (tx) =>
    bookOverbooking(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        medicalServiceId: juanService.id,
        start: at("12:00"),
        durationMinutes: 30,
        roomId: shared.id,
        ...overrides,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookOverbooking failed: ${result.reason}`);
  }
  return result.appointment;
}

async function weekOf(actor: Actor, query: Partial<CalendarWeekQuery> = {}) {
  const result = await asAppRole(db, (tx) =>
    getCalendarWeek(actor, { roomId: shared.id, date: "2099-01-07", ...query }, tx),
  );
  if (!result.ok || !result.week) {
    throw new Error(`getCalendarWeek failed: ${result.ok ? "no week" : result.reason}`);
  }
  return result.week;
}

/** Each free start of Monday as "HH:MM practitioner", in UTC. */
function mondayFree(week: Awaited<ReturnType<typeof weekOf>>) {
  const names = new Map(week.practitioners.map((one) => [one.id, one.displayName]));
  return week.days[0]!.freeStarts.map(
    (free) => `${free.start.toISOString().slice(11, 16)} ${names.get(free.practitionerId)}`,
  );
}

describe("the calendar week of a room", () => {
  it("shows Monday to Sunday around the date, with the room's practitioners in their colours", async () => {
    const week = await weekOf(world.receptionist);

    expect(week.room).toEqual({ id: shared.id, name: "Consultorio doble" });
    expect(week.office).toMatchObject({
      id: world.office.id,
      timeZone: "America/Argentina/Buenos_Aires",
    });
    expect(week.days.map((day) => day.date)).toEqual([
      "2099-01-05",
      "2099-01-06",
      "2099-01-07",
      "2099-01-08",
      "2099-01-09",
      "2099-01-10",
      "2099-01-11",
    ]);
    expect(week.practitioners).toEqual([
      { id: world.juan.id, displayName: "Juan Gómez", color: expect.stringMatching(/^color/) },
      { id: world.lucia.id, displayName: "Lucía Díaz", color: expect.stringMatching(/^color/) },
    ]);
    expect(week.medicalServices.map((service) => service.id).sort()).toEqual(
      [juanService.id, juanLongService.id, luciaService.id].sort(),
    );
  });

  it("frees a cell for every practitioner who is free for all of it, and draws the appointments", async () => {
    const { id } = await book();

    const week = await weekOf(world.receptionist);

    expect(mondayFree(week)).toEqual([
      "12:00 Lucía Díaz",
      "12:30 Juan Gómez",
      "12:30 Lucía Díaz",
      "13:00 Juan Gómez",
      "13:00 Lucía Díaz",
      "13:30 Juan Gómez",
      "13:30 Lucía Díaz",
    ]);
    expect(week.days[0]!.cards).toEqual([
      expect.objectContaining({
        kind: "appointment",
        id,
        practitionerId: world.juan.id,
        practitionerName: "Juan Gómez",
        patientName: "María Paz",
        medicalServiceName: "Consulta",
        receptionNote: "Trae estudios",
        status: "booked",
      }),
    ]);
    expect(week.days.slice(1).every((day) => day.freeStarts.length === 0)).toBe(true);
  });

  it("narrows to the practitioner asked for", async () => {
    await book();

    const week = await weekOf(world.receptionist, { practitionerId: world.lucia.id });

    expect(mondayFree(week)).toEqual(
      ["12:00", "12:30", "13:00", "13:30"].map((t) => `${t} Lucía Díaz`),
    );
    expect(week.days[0]!.cards).toEqual([]);
    expect(week.filter).toEqual({ practitionerId: world.lucia.id, medicalServiceId: null });
  });

  it("narrows to a medical service's practitioner, freeing only starts its duration fits from", async () => {
    await book();

    const week = await weekOf(world.receptionist, { medicalServiceId: juanLongService.id });

    expect(mondayFree(week)).toEqual(["12:30 Juan Gómez", "13:00 Juan Gómez"]);
    expect(week.filter).toEqual({
      practitionerId: world.juan.id,
      medicalServiceId: juanLongService.id,
    });
  });

  for (const gridMinutes of [20, 60]) {
    it(`frees only cells a booking can start on, on a ${gridMinutes}-minute grid, and each books`, async () => {
      await db.update(practitioner).set({ gridMinutes }).where(eq(practitioner.id, world.juan.id));

      const week = await weekOf(world.receptionist, { practitionerId: world.juan.id });
      const offered = week.days[0]!.freeStarts;

      expect(offered.map((free) => free.start)).toEqual([at("12:00"), at("13:00")]);
      for (const [index, free] of offered.entries()) {
        const patient = await world.addPatient(`Paciente ${index}`, `0351 15 555-000${index}`);
        await book({ patientId: patient.id, start: free.start });
      }
    });
  }

  it("hides cancelled and no-show appointments unless asked for, leaving their cell free", async () => {
    const { id } = await book();
    await asAppRole(db, (tx) =>
      cancelAppointment(world.receptionist, { appointmentId: id, cancelledBy: "patient" }, tx),
    );
    const { id: absentId } = await book({ start: at("13:00") });
    await db.update(appointment).set({ status: "noShow" }).where(eq(appointment.id, absentId));

    for (const actor of [world.receptionist, world.admin, world.juan.actor]) {
      const week = await weekOf(actor, { practitionerId: world.juan.id });
      expect(week.days[0]!.cards).toEqual([]);
      expect(week.days[0]!.freeStarts).toHaveLength(4);
    }
    const shown = await weekOf(world.receptionist, {
      practitionerId: world.juan.id,
      includeCancelledAndNoShow: true,
    });
    expect(shown.days[0]!.cards).toEqual([
      expect.objectContaining({ id, status: "cancelled" }),
      expect.objectContaining({ id: absentId, status: "noShow" }),
    ]);
    expect(shown.days[0]!.freeStarts).toHaveLength(4);
  });

  it("gives a practitioner their own appointments in full and no patient data about others'", async () => {
    const juans = await book();
    const pedro = await world.addPatient("Pedro", "0351 15 555-4321");
    await book({
      patientId: pedro.id,
      practitionerId: world.lucia.id,
      medicalServiceId: luciaService.id,
      start: at("12:30"),
    });

    const week = await weekOf(world.lucia.actor);

    expect(week.days[0]!.cards).toEqual([
      {
        kind: "busy",
        id: juans.id,
        start: at("12:00"),
        end: at("12:30"),
        practitionerId: world.juan.id,
        practitionerName: "Juan Gómez",
      },
      expect.objectContaining({ kind: "appointment", practitionerId: world.lucia.id }),
    ]);
    const sent = JSON.stringify(week.days[0]!.cards[0]);
    for (const leak of [maria.id, "María", "Trae estudios", juanService.id]) {
      expect(sent).not.toContain(leak);
    }
    // A practitioner books only for themselves.
    expect(mondayFree(week).every((free) => free.endsWith("Lucía Díaz"))).toBe(true);
  });

  it("offers each viewer the status changes and the undo they may make", async () => {
    const { id } = await book();
    await asAppRole(db, (tx) =>
      changeAppointmentStatus(world.receptionist, { appointmentId: id, status: "confirmed" }, tx),
    );

    const forReception = (await weekOf(world.receptionist)).days[0]!.cards[0]!;
    expect(forReception).toMatchObject({
      actions: ["checkedIn", "attended", "cancelled"],
      undoStatus: "booked",
    });
    const forJuan = (await weekOf(world.juan.actor)).days[0]!.cards[0]!;
    expect(forJuan).toMatchObject({ actions: ["attended", "cancelled"], undoStatus: "booked" });
  });

  it("draws an overbooking in the room it holds, and lists the office's rooms to move to", async () => {
    const pedro = await world.addPatient("Pedro", "0351 15 555-4321");
    await asAppRole(db, (tx) =>
      bookOverbooking(
        world.receptionist,
        {
          patientId: pedro.id,
          practitionerId: world.juan.id,
          medicalServiceId: juanService.id,
          start: at("15:00"),
          durationMinutes: 30,
          roomId: world.otherRoom.id,
        },
        tx,
      ),
    );

    const week = await weekOf(world.receptionist, { roomId: world.otherRoom.id });

    expect(week.office.rooms.map((one) => one.name)).toEqual([
      "Consultorio 1",
      "Consultorio 2",
      "Consultorio doble",
    ]);
    expect(week.days[0]!.cards).toEqual([
      expect.objectContaining({ overbooking: true, roomName: "Consultorio 2" }),
    ]);
  });

  it("lists the active rooms by office and opens on the first one when none is asked for", async () => {
    const result = await asAppRole(db, (tx) =>
      getCalendarWeek(world.receptionist, { date: "2099-01-07" }, tx),
    );

    expect(result).toMatchObject({
      ok: true,
      roomChoices: [
        {
          officeId: world.office.id,
          officeName: "Sede Centro",
          rooms: [
            { id: world.room.id, name: "Consultorio 1" },
            { id: world.otherRoom.id, name: "Consultorio 2" },
            { id: shared.id, name: "Consultorio doble" },
          ],
        },
      ],
      week: { room: { id: world.room.id } },
    });
  });

  it("ignores a deactivated medical service, keeping the practitioner asked for", async () => {
    await db
      .update(medicalService)
      .set({ active: false })
      .where(eq(medicalService.id, luciaService.id));

    const week = await weekOf(world.receptionist, {
      practitionerId: world.lucia.id,
      medicalServiceId: luciaService.id,
    });

    expect(week.filter).toEqual({ practitionerId: world.lucia.id, medicalServiceId: null });
    expect(mondayFree(week)).toHaveLength(4);
  });

  it("ignores a practitioner and a medical service with nothing in the room that week", async () => {
    const week = await weekOf(world.receptionist, {
      roomId: world.room.id,
      practitionerId: world.juan.id,
      medicalServiceId: juanService.id,
    });

    expect(week.room.id).toBe(world.room.id);
    expect(week.filter).toEqual({ practitionerId: null, medicalServiceId: null });
  });

  it("ignores a practitioner or a medical service that does not exist", async () => {
    const week = await weekOf(world.receptionist, {
      practitionerId: world.room.id,
      medicalServiceId: world.room.id,
    });

    expect(week.filter).toEqual({ practitionerId: null, medicalServiceId: null });
    expect(mondayFree(week)).toHaveLength(8);
  });

  it("narrows the cards to the medical service filtered by", async () => {
    const { id } = await book();
    const pedro = await world.addPatient("Pedro", "0351 15 555-4321");
    await book({
      patientId: pedro.id,
      medicalServiceId: juanLongService.id,
      start: at("13:00"),
      durationMinutes: 60,
    });

    const week = await weekOf(world.receptionist, { medicalServiceId: juanService.id });

    expect(week.days[0]!.cards).toEqual([expect.objectContaining({ id })]);
  });

  it("keys each busy block by its appointment, so two overbookings at one start stay two", async () => {
    const first = await overbook();
    const pedro = await world.addPatient("Pedro", "0351 15 555-4321");
    const second = await overbook({ patientId: pedro.id });

    const week = await weekOf(world.lucia.actor);

    expect(week.days[0]!.cards.map((card) => card.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("draws an appointment across midnight on both days, in both weeks", async () => {
    // Sunday 2099-01-11 23:30 to Monday 00:30 in Buenos Aires.
    const { id } = await overbook({ start: at("02:30", "2099-01-12"), durationMinutes: 60 });

    const sunday = (await weekOf(world.receptionist)).days[6]!;
    const monday = (await weekOf(world.receptionist, { date: "2099-01-12" })).days[0]!;

    expect(sunday.cards).toEqual([expect.objectContaining({ id })]);
    expect(monday.cards).toEqual([expect.objectContaining({ id })]);
  });

  it("lists a practitioner with an appointment in the room that week but no schedule there", async () => {
    await overbook({ roomId: world.otherRoom.id, start: at("15:00") });

    const week = await weekOf(world.receptionist, { roomId: world.otherRoom.id });

    expect(week.practitioners.map((one) => one.id)).toEqual([world.juan.id]);
    expect(week.medicalServices.map((one) => one.id).sort()).toEqual(
      [juanService.id, juanLongService.id].sort(),
    );
    expect(week.days.every((day) => day.freeStarts.length === 0)).toBe(true);
  });
});
