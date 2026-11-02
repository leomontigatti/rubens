import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Transaction } from "#/db/tenant.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { lostRoomRace, updateRow, writeRoomChange } from "#/server/appointment-placement-steps.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";

// Lost races. PGlite runs one connection, so a service cannot lose one here:
// each test fixes the violation with rows already present, then calls the
// write step directly, past the checks that would have refused it.
//
// The office is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05
// is a Monday; Juan works there from 09:00 to 11:00 in "Consultorio 1",
// "Lucía" from 09:00 to 11:00 in "Consultorio 2".

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let world: BookingWorld;
let juanService: { id: string };
let luciaService: { id: string };
let maria: { id: string };
let pedro: { id: string };

beforeEach(async () => {
  db = await testDatabase.reset();
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanService = await world.addMedicalService(world.juan.id);
  luciaService = await world.addMedicalService(world.lucia.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
  pedro = await world.addPatient("Pedro", "0351 15 555-9876");
});

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function asTenant<T>(work: (tenant: Transaction) => Promise<T>) {
  return asAppRole(db, (tx) => withTenant(world.admin, work, tx));
}

async function booked(
  who: "juan" | "lucia",
  patientId: string,
  start: Date,
): Promise<typeof appointment.$inferSelect> {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId,
        practitionerId: world[who].id,
        medicalServiceId: who === "juan" ? juanService.id : luciaService.id,
        start,
        durationMinutes: 30,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return rowOf(result.appointment.id);
}

async function rowOf(id: string) {
  const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
  return row!;
}

describe("the write step", () => {
  it("reports appointment_practitioner_overlap as the practitioner's constraint", async () => {
    await booked("juan", maria.id, at("12:00"));
    const later = await booked("juan", pedro.id, at("12:30"));

    expect(
      await asTenant((tenant) =>
        updateRow(tenant, later.id, { during: { start: at("12:15"), end: at("12:45") } }),
      ),
    ).toEqual({ ok: false, constraint: "practitioner" });
  });

  it("reports appointment_room_overlap as the room's constraint", async () => {
    await booked("juan", maria.id, at("12:00"));
    const lucias = await booked("lucia", pedro.id, at("12:00"));

    expect(
      await asTenant((tenant) => updateRow(tenant, lucias.id, { roomId: world.room.id })),
    ).toEqual({ ok: false, constraint: "room" });
  });

  it("lets any other failure through", async () => {
    const juans = await booked("juan", maria.id, at("12:00"));

    await expect(
      asTenant((tenant) =>
        updateRow(tenant, juans.id, { roomId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).rejects.toThrow();
  });
});

describe("a room move that loses the race", () => {
  it("is refused as room full, naming who took the room, and stays where it was", async () => {
    await booked("juan", maria.id, at("12:00"));
    const lucias = await booked("lucia", pedro.id, at("12:00"));

    expect(await asTenant((tenant) => writeRoomChange(tenant, lucias, world.room.id))).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        {
          practitionerName: "Juan Gómez",
          kind: "appointment",
          start: at("12:00"),
          end: at("12:30"),
        },
      ],
    });
    expect(await rowOf(lucias.id)).toMatchObject({ roomId: world.otherRoom.id });
  });

  it("is still room full when the second check cannot see the winner", async () => {
    const third = await world.addRoom(world.office.id, "Consultorio 3");

    expect(
      await asTenant((tenant) =>
        lostRoomRace(tenant, third.id, world.juan.id, { start: at("12:00"), end: at("12:30") }),
      ),
    ).toEqual({ ok: false, reason: "roomFull", occupants: [] });
  });
});
