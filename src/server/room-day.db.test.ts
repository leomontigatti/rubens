import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import { cancelAppointment } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getRoomDay } from "#/server/room-day.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works there
// from 09:00 to 11:00 in "Consultorio 1", "Lucía" from 14:00 to 16:00 in
// "Consultorio 2".

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanService: { id: string };
let maria: { id: string };

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({
    practitionerId: world.lucia.id,
    roomId: world.otherRoom.id,
    startTime: "14:00",
    endTime: "16:00",
  });
  juanService = await world.addMedicalService(world.juan.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
});

afterEach(async () => {
  await client.close();
});

async function book(start: Date, receptionNote = "trae radiografías") {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        medicalServiceId: juanService.id,
        start,
        durationMinutes: 30,
        receptionNote,
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

function roomDay(actor = world.receptionist) {
  return asAppRole(db, (tx) =>
    getRoomDay(actor, { officeId: world.office.id, date: "2099-01-05" }, tx),
  );
}

describe("the room view", () => {
  it("shows who holds each room and when, by schedules and appointments", async () => {
    await book(at("12:30"));

    const result = await roomDay();

    expect(result.ok && result.rooms).toEqual([
      {
        id: world.room.id,
        name: "Consultorio 1",
        blocks: [
          {
            kind: "schedule",
            start: at("12:00"),
            end: at("14:00"),
            practitionerName: "Juan Gómez",
            overbooking: false,
          },
          {
            kind: "appointment",
            start: at("12:30"),
            end: at("13:00"),
            practitionerName: "Juan Gómez",
            overbooking: false,
          },
        ],
      },
      {
        id: world.otherRoom.id,
        name: "Consultorio 2",
        blocks: [
          {
            kind: "schedule",
            start: at("17:00"),
            end: at("19:00"),
            practitionerName: "Lucía Díaz",
            overbooking: false,
          },
        ],
      },
    ]);
  });

  it("shows an overbooking in the room it holds, outside the schedules, and no cancelled appointment", async () => {
    const cancelled = await book(at("13:00"));
    await asAppRole(db, (tx) =>
      cancelAppointment(
        world.receptionist,
        { appointmentId: cancelled, cancelledBy: "patient", reason: null },
        tx,
      ),
    );
    const overbooked = await asAppRole(db, (tx) =>
      bookOverbooking(
        world.receptionist,
        {
          patientId: maria.id,
          practitionerId: world.juan.id,
          medicalServiceId: juanService.id,
          start: at("21:00"),
          durationMinutes: 30,
          roomId: world.otherRoom.id,
        },
        tx,
      ),
    );
    expect(overbooked.ok).toBe(true);

    const result = await roomDay();
    const appointments = result.ok
      ? result.rooms.flatMap((room) =>
          room.blocks
            .filter((block) => block.kind === "appointment")
            .map((block) => ({ room: room.name, ...block })),
        )
      : [];

    expect(appointments).toEqual([
      {
        room: "Consultorio 2",
        kind: "appointment",
        start: at("21:00"),
        end: at("21:30"),
        practitionerName: "Juan Gómez",
        overbooking: true,
      },
    ]);
  });

  it("returns no patient data to anyone", async () => {
    await book(at("12:30"));

    const text = JSON.stringify(await roomDay());

    expect(text).not.toContain("María");
    expect(text).not.toContain(maria.id);
    expect(text).not.toContain("radiografías");
  });

  it("is open to every staff role, a practitioner seeing everyone's rooms", async () => {
    await book(at("12:30"));

    for (const actor of [world.admin, world.receptionist, world.lucia.actor]) {
      const result = await roomDay(actor);
      expect(result.ok && result.rooms.map((room) => room.blocks.length)).toEqual([2, 1]);
    }
  });
});
