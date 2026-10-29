import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { BookingInput, WarningConfirmation } from "#/lib/appointments.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { setMedicalServiceActive } from "#/server/medical-services.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment, insertAppointment } from "#/server/appointments.ts";
import { getAvailability } from "#/server/availability.ts";
import { createTimeOff } from "#/server/time-off.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works there
// from 09:00 to 11:00 in "Consultorio 1", "Lucía" from 09:00 to 11:00 in
// "Consultorio 2".

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanService: { id: string };
let luciaService: { id: string };
let maria: { id: string };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanService = await world.addMedicalService(world.juan.id);
  luciaService = await world.addMedicalService(world.lucia.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
});

afterEach(async () => {
  await client.close();
});

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function booking(overrides: Partial<BookingInput> = {}): BookingInput {
  return {
    patientId: maria.id,
    practitionerId: world.juan.id,
    medicalServiceId: juanService.id,
    start: at("12:00"),
    durationMinutes: 30,
    ...overrides,
  };
}

function book(
  actor: Actor = world.receptionist,
  input: BookingInput & WarningConfirmation = booking(),
) {
  return asAppRole(db, (tx) => bookAppointment(actor, input, tx));
}

async function booked(actor: Actor = world.receptionist, input = booking()) {
  const result = await book(actor, input);
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
  return row!;
}

async function freeStartsOfJuan() {
  const result = await asAppRole(db, (tx) =>
    getAvailability(
      world.admin,
      {
        practitionerId: world.juan.id,
        firstDate: "2099-01-05",
        lastDate: "2099-01-05",
        durationMinutes: 30,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`getAvailability failed: ${result.reason}`);
  }
  return result.freeStarts.map((free) => free.start.toISOString());
}

describe("booking an appointment", () => {
  it("books a free time in the room of the schedule it falls in, with the reception note", async () => {
    const created = await booked(world.receptionist, {
      ...booking({ durationMinutes: 45 }),
      receptionNote: "  Trae radiografías ",
    });

    expect(await rowOf(created.id)).toMatchObject({
      patientId: maria.id,
      practitionerId: world.juan.id,
      medicalServiceId: juanService.id,
      roomId: world.room.id,
      during: { start: at("12:00"), end: at("12:45") },
      status: "booked",
      overbooking: false,
      receptionNote: "Trae radiografías",
      createdBy: world.receptionist.userId,
    });
  });

  it("refuses a start off the grid, outside the schedules or in time off", async () => {
    await asAppRole(db, (tx) =>
      createTimeOff(
        world.admin,
        {
          practitionerId: world.juan.id,
          entry: { kind: "hours", start: "2099-01-05T10:00", end: "2099-01-05T11:00" },
        },
        tx,
      ),
    );

    for (const start of [at("12:10"), at("14:30"), at("13:00"), at("13:45")]) {
      expect(await book(world.receptionist, booking({ start }))).toEqual({
        ok: false,
        reason: "notFree",
      });
    }
  });

  it("refuses a duration that runs past the schedule's end", async () => {
    expect(
      await book(world.receptionist, booking({ start: at("13:30"), durationMinutes: 60 })),
    ).toEqual({ ok: false, reason: "notFree" });
    expect(await book(world.receptionist, booking({ start: at("13:30") }))).toMatchObject({
      ok: true,
    });
  });

  it("takes a booked time out of the free times, so it cannot be booked again", async () => {
    await booked();
    const pedro = await world.addPatient("Pedro", "0351 15 555-9876");

    expect(await freeStartsOfJuan()).not.toContain("2099-01-05T12:00:00.000Z");
    expect(await freeStartsOfJuan()).not.toContain("2099-01-05T12:15:00.000Z");
    expect(await freeStartsOfJuan()).toContain("2099-01-05T12:30:00.000Z");
    expect(await book(world.receptionist, booking({ patientId: pedro.id }))).toEqual({
      ok: false,
      reason: "notFree",
    });
  });

  it("refuses another practitioner's medical service and a deactivated one", async () => {
    expect(await book(world.receptionist, booking({ medicalServiceId: luciaService.id }))).toEqual({
      ok: false,
      reason: "notFound",
    });
    await asAppRole(db, (tx) =>
      setMedicalServiceActive(world.admin, { id: juanService.id, active: false }, tx),
    );
    expect(await book()).toEqual({ ok: false, reason: "medicalServiceInactive" });
  });

  it("writes the booking to the audit log, about the patient", async () => {
    const created = await booked();

    const entries = await asAppRole(db, (tx) =>
      withTenant(
        world.admin,
        (tenant) => tenant.select().from(auditLog).where(eq(auditLog.entityId, created.id)),
        tx,
      ),
    );
    expect(entries).toEqual([
      expect.objectContaining({
        action: "create",
        entityType: "appointment",
        patientId: maria.id,
        userId: world.receptionist.userId,
        after: expect.objectContaining({
          practitionerId: world.juan.id,
          roomId: world.room.id,
          start: "2099-01-05T12:00:00.000Z",
          end: "2099-01-05T12:30:00.000Z",
          status: "booked",
        }),
      }),
    ]);
  });
});

describe("the patient warning", () => {
  it("warns when the patient has an overlapping appointment, and books once confirmed", async () => {
    await booked(
      world.receptionist,
      booking({ practitionerId: world.lucia.id, medicalServiceId: luciaService.id }),
    );

    const warned = await book(world.receptionist, booking());

    expect(warned).toEqual({
      ok: false,
      reason: "patientWarning",
      warnings: [
        {
          kind: "overlap",
          start: at("12:00"),
          end: at("12:30"),
          practitionerName: "Lucía Díaz",
          timeZone: "America/Argentina/Buenos_Aires",
        },
      ],
    });
    expect(await book(world.receptionist, { ...booking(), confirmWarnings: true })).toMatchObject({
      ok: true,
    });
  });

  it("warns of another appointment the same day, and not of one another day", async () => {
    await booked(
      world.receptionist,
      booking({
        practitionerId: world.lucia.id,
        medicalServiceId: luciaService.id,
        start: at("13:00"),
      }),
    );

    expect(await book()).toMatchObject({
      ok: false,
      reason: "patientWarning",
      warnings: [{ kind: "sameDay", start: at("13:00"), practitionerName: "Lucía Díaz" }],
    });

    await world.addSchedule({
      practitionerId: world.juan.id,
      weekdays: [2],
      firstDate: "2099-01-06",
    });
    const pedro = await world.addPatient("Pedro", "0351 15 555-9876");
    await booked(world.receptionist, booking({ patientId: pedro.id }));
    expect(
      await book(
        world.receptionist,
        booking({ patientId: pedro.id, start: new Date("2099-01-06T12:00:00Z") }),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("who books", () => {
  it("lets reception and admins book for anyone, and a practitioner only for themselves", async () => {
    expect(await book(world.admin)).toMatchObject({ ok: true });
    expect(
      await book(world.lucia.actor, {
        ...booking({ practitionerId: world.lucia.id, medicalServiceId: luciaService.id }),
        confirmWarnings: true,
      }),
    ).toMatchObject({ ok: true });
    expect(await book(world.lucia.actor, booking({ start: at("12:30") }))).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses a member with no booking role", async () => {
    const nobody: Actor = { ...world.receptionist, roles: [] };

    expect(await book(nobody)).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("the database guarantee against double booking", () => {
  let first: typeof appointment.$inferSelect;

  beforeEach(async () => {
    first = await rowOf((await booked()).id);
  });

  function insertOver(values: Partial<typeof appointment.$inferInsert>) {
    return asAppRole(db, (tx) =>
      withTenant(
        world.admin,
        (tenant) =>
          insertAppointment(tenant, {
            ...first,
            id: undefined,
            during: { start: at("12:15"), end: at("12:45") },
            ...values,
          }),
        tx,
      ),
    );
  }

  it("turns an overlap with an active appointment into the time-taken result", async () => {
    expect(await insertOver({})).toEqual({ ok: false, reason: "timeTaken" });
  });

  it("turns another practitioner's overlap in the same room into the time-taken result, overbooking or not", async () => {
    const lucias = { practitionerId: world.lucia.id, medicalServiceId: luciaService.id };

    expect(await insertOver(lucias)).toEqual({ ok: false, reason: "timeTaken" });
    expect(await insertOver({ ...lucias, overbooking: true })).toEqual({
      ok: false,
      reason: "timeTaken",
    });
    expect(await insertOver({ ...lucias, roomId: world.otherRoom.id })).toMatchObject({
      ok: true,
    });
  });

  it("lets an overbooking and a cancelled appointment overlap", async () => {
    expect(await insertOver({ overbooking: true })).toMatchObject({ ok: true });
    await client.query("delete from rubens.appointment where overbooking");
    expect(await insertOver({ status: "cancelled", cancelledBy: "patient" })).toMatchObject({
      ok: true,
    });
  });
});

describe("a room two practitioners share", () => {
  // Both work there from 11:00 to 13:00 too, 14:00Z to 16:00Z.
  beforeEach(async () => {
    const shared = await world.addRoom(world.office.id, "Consultorio doble", 2);
    for (const practitionerId of [world.juan.id, world.lucia.id]) {
      await world.addSchedule({
        practitionerId,
        roomId: shared.id,
        startTime: "11:00",
        endTime: "13:00",
      });
    }
    await booked(world.receptionist, booking({ start: at("14:00") }));
  });

  it("offers no other practitioner the time an appointment there holds, and refuses booking it", async () => {
    const pedro = await world.addPatient("Pedro", "0351 15 555-4321");
    const lucias = booking({
      patientId: pedro.id,
      practitionerId: world.lucia.id,
      medicalServiceId: luciaService.id,
      start: at("14:00"),
    });

    const availability = await asAppRole(db, (tx) =>
      getAvailability(
        world.admin,
        {
          practitionerId: world.lucia.id,
          firstDate: "2099-01-05",
          lastDate: "2099-01-05",
          durationMinutes: 30,
        },
        tx,
      ),
    );
    const offered = availability.ok ? availability.freeStarts.map((free) => +free.start) : [];

    expect(offered).toContain(+at("14:30"));
    expect(offered).not.toContain(+at("14:00"));
    expect(await book(world.receptionist, lucias)).toEqual({ ok: false, reason: "notFree" });
  });
});
