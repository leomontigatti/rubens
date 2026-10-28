import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { BookingInput, WarningConfirmation } from "#/lib/appointments.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { cancelAppointment, changeAppointmentStatus } from "#/server/appointment-statuses.ts";
import { setAppointmentTypeActive } from "#/server/appointment-types.ts";
import { createBookingWorld } from "#/server/appointments.test-support.ts";
import type { BookingWorld } from "#/server/appointments.test-support.ts";
import { bookAppointment, getOfficeDay, insertAppointment } from "#/server/appointments.ts";
import { getAvailability } from "#/server/availability.ts";
import { createTimeOff } from "#/server/time-off.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works there
// from 09:00 to 11:00 in Consultorio 1, Lucía from 09:00 to 11:00 in
// Consultorio 2.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanType: { id: string };
let luciaType: { id: string };
let maria: { id: string };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanType = await world.addType(world.juan.id);
  luciaType = await world.addType(world.lucia.id);
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
    appointmentTypeId: juanType.id,
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
      appointmentTypeId: juanType.id,
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

  it("refuses another practitioner's type and a deactivated one", async () => {
    expect(await book(world.receptionist, booking({ appointmentTypeId: luciaType.id }))).toEqual({
      ok: false,
      reason: "notFound",
    });
    await asAppRole(db, (tx) =>
      setAppointmentTypeActive(world.admin, { id: juanType.id, active: false }, tx),
    );
    expect(await book()).toEqual({ ok: false, reason: "appointmentTypeInactive" });
  });

  it("refuses a reception note longer than a short line", async () => {
    expect(
      await book(world.receptionist, { ...booking(), receptionNote: "x".repeat(201) }),
    ).toEqual({ ok: false, reason: "invalidInput" });
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
      booking({ practitionerId: world.lucia.id, appointmentTypeId: luciaType.id }),
    );

    const warned = await book(world.receptionist, booking({ start: at("12:15") }));

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
    expect(
      await book(world.receptionist, { ...booking({ start: at("12:15") }), confirmWarnings: true }),
    ).toMatchObject({ ok: true });
  });

  it("warns of another appointment the same day, and not of one another day", async () => {
    await booked(
      world.receptionist,
      booking({
        practitionerId: world.lucia.id,
        appointmentTypeId: luciaType.id,
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
        ...booking({ practitionerId: world.lucia.id, appointmentTypeId: luciaType.id }),
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

  it("lets an overbooking and a cancelled appointment overlap", async () => {
    expect(await insertOver({ overbooking: true })).toMatchObject({ ok: true });
    await client.query("delete from rubens.appointment where overbooking");
    expect(await insertOver({ status: "cancelled", cancelledBy: "patient" })).toMatchObject({
      ok: true,
    });
  });
});

describe("the office day view", () => {
  async function dayOf(actor: Actor) {
    const result = await asAppRole(db, (tx) =>
      getOfficeDay(actor, { officeId: world.office.id, date: "2099-01-05" }, tx),
    );
    if (!result.ok) {
      throw new Error(`getOfficeDay failed: ${result.reason}`);
    }
    return result;
  }

  it("shows a column per practitioner present, with their appointments and free times", async () => {
    await booked(world.receptionist, { ...booking(), receptionNote: "Trae estudios" });

    const day = await dayOf(world.receptionist);

    expect(day.columns.map((column) => column.practitioner.displayName)).toEqual([
      "Juan Gómez",
      "Lucía Díaz",
    ]);
    const juan = day.columns[0]!;
    expect(juan.schedules).toEqual([
      { start: at("12:00"), end: at("14:00"), roomName: "Consultorio 1" },
    ]);
    expect(juan.appointments).toEqual([
      expect.objectContaining({
        start: at("12:00"),
        end: at("12:30"),
        status: "booked",
        overbooking: false,
        patientName: "María Paz",
        typeName: "Consulta",
        color: "color1",
        roomName: "Consultorio 1",
        receptionNote: "Trae estudios",
      }),
    ]);
    // Free starts on Juan's 15-minute grid, a grid step long.
    expect(juan.freeStarts.map((free) => free.start)).toEqual(
      ["12:30", "12:45", "13:00", "13:15", "13:30", "13:45"].map(at),
    );
    expect(juan.freeStarts[0]).toMatchObject({ roomId: world.room.id, roomName: "Consultorio 1" });
  });

  it("leaves out a practitioner with no schedule or appointment at the office that day", async () => {
    const norte = await world.addOffice("Sede Norte");
    const norteRoom = await world.addRoom(norte.id, "Consultorio Norte");
    await world.addSchedule({
      practitionerId: world.lucia.id,
      roomId: norteRoom.id,
      weekdays: [3],
    });

    const day = await asAppRole(db, (tx) =>
      getOfficeDay(world.receptionist, { officeId: norte.id, date: "2099-01-05" }, tx),
    );

    expect(day).toMatchObject({ ok: true, columns: [] });
  });

  it("hides cancelled appointments unless asked for", async () => {
    const { id } = await booked();
    await asAppRole(db, (tx) =>
      cancelAppointment(world.receptionist, { appointmentId: id, cancelledBy: "business" }, tx),
    );

    expect((await dayOf(world.receptionist)).columns[0]!.appointments).toEqual([]);
    const withCancelled = await asAppRole(db, (tx) =>
      getOfficeDay(
        world.receptionist,
        { officeId: world.office.id, date: "2099-01-05", includeCancelled: true },
        tx,
      ),
    );
    expect(withCancelled.ok && withCancelled.columns[0]!.appointments).toEqual([
      expect.objectContaining({ id, status: "cancelled", cancelledBy: "business" }),
    ]);
  });

  it("offers each viewer the status changes and the undo they may make", async () => {
    const { id } = await booked();
    await asAppRole(db, (tx) =>
      changeAppointmentStatus(world.receptionist, { appointmentId: id, status: "confirmed" }, tx),
    );

    const forReception = (await dayOf(world.receptionist)).columns[0]!.appointments[0]!;
    expect(forReception).toMatchObject({
      actions: ["checkedIn", "attended", "cancelled"],
      undoStatus: "booked",
    });
    const forJuan = (await dayOf(world.juan.actor)).columns[0]!.appointments[0]!;
    expect(forJuan).toMatchObject({ actions: ["attended", "cancelled"], undoStatus: "booked" });
  });

  it("shows a practitioner only their own column", async () => {
    const day = await dayOf(world.lucia.actor);

    expect(day.columns.map((column) => column.practitioner.displayName)).toEqual(["Lucía Díaz"]);
  });
});
