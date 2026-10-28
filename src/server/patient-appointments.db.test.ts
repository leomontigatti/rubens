import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { cancelAppointment } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/server/appointments.test-support.ts";
import type { BookingWorld } from "#/server/appointments.test-support.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { listPatientAppointments } from "#/server/patient-appointments.ts";
import type { Actor } from "#/lib/access.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3). Juan and "Lucía" work Mondays from 09:00 to 11:00 (12:00Z to 14:00Z),
// in "Consultorio 1" and "Consultorio 2". 2099-01-05 and 2099-01-12 are Mondays.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let maria: { id: string };
let types: Map<string, string>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  types = new Map([
    [world.juan.id, (await world.addType(world.juan.id)).id],
    [world.lucia.id, (await world.addType(world.lucia.id)).id],
  ]);
  maria = await world.addPatient("María", "0351 15 555-1234");
});

afterEach(async () => {
  vi.useRealTimers();
  await client.close();
});

async function book(practitionerId: string, start: string) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId,
        appointmentTypeId: types.get(practitionerId)!,
        start: new Date(start),
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

async function history(actor: Actor) {
  const result = await asAppRole(db, (tx) =>
    listPatientAppointments(actor, { patientId: maria.id }, tx),
  );
  if (!result.ok) {
    throw new Error(`listPatientAppointments failed: ${result.reason}`);
  }
  return { upcoming: result.upcoming.map((row) => row.id), past: result.past.map((row) => row.id) };
}

describe("a patient's appointments", () => {
  it("splits past from upcoming, cancellations included, nearest first", async () => {
    const first = await book(world.juan.id, "2099-01-05T12:00:00Z");
    const second = await book(world.lucia.id, "2099-01-05T13:00:00Z");
    const later = await book(world.juan.id, "2099-01-12T12:00:00Z");
    await asAppRole(db, (tx) =>
      cancelAppointment(world.receptionist, { appointmentId: second, cancelledBy: "patient" }, tx),
    );
    vi.setSystemTime(new Date("2099-01-05T13:30:00Z"));

    expect(await history(world.receptionist)).toEqual({ upcoming: [later], past: [second, first] });
    const result = await asAppRole(db, (tx) =>
      listPatientAppointments(world.receptionist, { patientId: maria.id }, tx),
    );
    expect(result.ok && result.past[0]).toMatchObject({
      status: "cancelled",
      cancelledBy: "patient",
      practitionerName: "Lucía Díaz",
      officeName: "Sede Centro",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  });

  it("shows a practitioner only the appointments with themselves", async () => {
    const withJuan = await book(world.juan.id, "2099-01-05T12:00:00Z");
    await book(world.lucia.id, "2099-01-05T13:00:00Z");

    expect(await history(world.juan.actor)).toEqual({ upcoming: [withJuan], past: [] });
  });

  it("answers notFound for an unknown patient", async () => {
    expect(
      await asAppRole(db, (tx) =>
        listPatientAppointments(world.receptionist, { patientId: crypto.randomUUID() }, tx),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
