import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { OverbookingInput, WarningConfirmation } from "#/lib/appointments.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { bookOverbooking, moveAppointmentRoom } from "#/server/appointment-rooms.ts";
import { createBookingWorld } from "#/server/appointments.test-support.ts";
import type { BookingWorld } from "#/server/appointments.test-support.ts";
import { bookAppointment, getOfficeDay } from "#/server/appointments.ts";
import { getAvailability } from "#/server/availability.ts";
import { createClosure } from "#/server/closures.ts";
import { listSchedulePractitioners } from "#/server/schedules.ts";
import { createTimeOff } from "#/server/time-off.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works there
// from 09:00 to 11:00 in Consultorio 1, Lucía from 09:00 to 11:00 in
// Consultorio 2, both rooms of capacity 1. Consultorio 3 is empty, of
// capacity 1, and Consultorio 4 of capacity 2.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanType: { id: string };
let luciaType: { id: string };
let maria: { id: string };
let pedro: { id: string };
let third: { id: string };
let double: { id: string };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  third = await world.addRoom(world.office.id, "Consultorio 3");
  double = await world.addRoom(world.office.id, "Consultorio 4", 2);
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanType = await world.addType(world.juan.id);
  luciaType = await world.addType(world.lucia.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
  pedro = await world.addPatient("Pedro", "0351 15 555-9876");
});

afterEach(async () => {
  await client.close();
});

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function overbooking(overrides: Partial<OverbookingInput> = {}): OverbookingInput {
  return {
    patientId: pedro.id,
    practitionerId: world.juan.id,
    appointmentTypeId: juanType.id,
    start: at("12:10"),
    durationMinutes: 30,
    roomId: null,
    ...overrides,
  };
}

function overbook(
  actor: Actor = world.receptionist,
  input: OverbookingInput & WarningConfirmation = overbooking(),
) {
  return asAppRole(db, (tx) => bookOverbooking(actor, input, tx));
}

async function overbooked(input: OverbookingInput, actor: Actor = world.receptionist) {
  const result = await overbook(actor, input);
  if (!result.ok) {
    throw new Error(`bookOverbooking failed: ${result.reason}`);
  }
  return result.appointment;
}

async function bookedForJuan() {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        appointmentTypeId: juanType.id,
        start: at("12:00"),
        durationMinutes: 30,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
  return row!;
}

function auditOf(id: string) {
  return asAppRole(db, (tx) =>
    withTenant(
      world.admin,
      (tenant) => tenant.select().from(auditLog).where(eq(auditLog.entityId, id)),
      tx,
    ),
  );
}

function move(roomId: string, appointmentId: string, actor: Actor = world.receptionist) {
  return asAppRole(db, (tx) => moveAppointmentRoom(actor, { appointmentId, roomId }, tx));
}

describe("a sobreturno on top of another appointment", () => {
  it("books over the appointment, off the grid, in the room of the schedule", async () => {
    await bookedForJuan();

    const created = await overbooked(overbooking());

    expect(await rowOf(created.id)).toMatchObject({
      patientId: pedro.id,
      practitionerId: world.juan.id,
      roomId: world.room.id,
      during: { start: at("12:10"), end: at("12:40") },
      status: "booked",
      overbooking: true,
      createdBy: world.receptionist.userId,
    });
  });

  it("is a busy range, never offered as a free time", async () => {
    await overbooked(overbooking({ start: at("13:00") }));

    const result = await asAppRole(db, (tx) =>
      getAvailability(
        world.admin,
        {
          practitionerId: world.juan.id,
          firstDate: "2099-01-05",
          lastDate: "2099-01-05",
          durationMinutes: 15,
        },
        tx,
      ),
    );

    expect(result.ok && result.freeStarts.map((free) => free.start)).toEqual(
      ["12:00", "12:15", "12:30", "12:45", "13:30", "13:45"].map(at),
    );
  });

  it("is refused in the practitioner's time off and in a closure, with a structured result", async () => {
    const entry: RangeEntry = {
      kind: "hours",
      start: "2099-01-05T09:00",
      end: "2099-01-05T09:30",
    };
    await asAppRole(db, (tx) =>
      createTimeOff(world.admin, { practitionerId: world.juan.id, entry }, tx),
    );
    expect(await overbook()).toEqual({ ok: false, reason: "timeOff" });

    await asAppRole(db, (tx) =>
      createClosure(
        world.admin,
        {
          officeId: world.office.id,
          entry: { kind: "hours", start: "2099-01-05T10:00", end: "2099-01-05T10:30" },
        },
        tx,
      ),
    );
    expect(await overbook(world.receptionist, overbooking({ start: at("13:00") }))).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("warns of the patient's other appointment that day, like a booking", async () => {
    await bookedForJuan();

    expect(await overbook(world.receptionist, overbooking({ patientId: maria.id }))).toMatchObject({
      ok: false,
      reason: "patientWarning",
      warnings: [{ kind: "overlap" }],
    });
    expect(
      await overbook(world.receptionist, {
        ...overbooking({ patientId: maria.id }),
        confirmWarnings: true,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("a sobreturno outside the practitioner's schedules", () => {
  it("needs a room picked", async () => {
    expect(await overbook(world.receptionist, overbooking({ start: at("15:00") }))).toEqual({
      ok: false,
      reason: "roomRequired",
    });
  });

  it("books in a room with space", async () => {
    const created = await overbooked(overbooking({ start: at("15:00"), roomId: third.id }));

    expect(await rowOf(created.id)).toMatchObject({ roomId: third.id, overbooking: true });
  });

  it("is refused in a room another practitioner's schedule fills, naming them", async () => {
    expect(
      await overbook(
        world.receptionist,
        overbooking({ start: at("12:30"), roomId: world.otherRoom.id }),
      ),
    ).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        { practitionerName: "Lucía Díaz", kind: "schedule", start: at("12:00"), end: at("14:00") },
      ],
    });
  });

  it("is refused in a room another practitioner's appointment fills", async () => {
    await overbooked(
      overbooking({
        practitionerId: world.lucia.id,
        appointmentTypeId: luciaType.id,
        patientId: maria.id,
        start: at("15:00"),
        roomId: third.id,
      }),
    );

    expect(
      await overbook(world.receptionist, overbooking({ start: at("15:15"), roomId: third.id })),
    ).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        {
          practitionerName: "Lucía Díaz",
          kind: "appointment",
          start: at("15:00"),
          end: at("15:30"),
        },
      ],
    });
  });

  it("fits beside one other practitioner in a room of capacity 2, and not beside two", async () => {
    // Lucía's second schedule follows the one in Consultorio 2.
    await world.addSchedule({
      practitionerId: world.lucia.id,
      roomId: double.id,
      startTime: "11:00",
      endTime: "13:00",
    });
    const inDouble = overbooking({ start: at("14:30"), roomId: double.id });

    expect(await overbook(world.receptionist, inDouble)).toMatchObject({ ok: true });

    await world.addStaff("Ana Ruiz");
    const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
    const ana = listed.find((row) => row.displayName === "Ana Ruiz")!;
    await world.addSchedule({
      practitionerId: ana.id,
      roomId: double.id,
      startTime: "11:00",
      endTime: "12:00",
    });

    expect(
      await overbook(world.receptionist, { ...inDouble, patientId: maria.id, start: at("14:00") }),
    ).toMatchObject({
      ok: false,
      reason: "roomFull",
      occupants: [{ practitionerName: "Ana Ruiz" }, { practitionerName: "Lucía Díaz" }],
    });
  });

  it("adds no practitioner on top of their own appointment in that room", async () => {
    await overbooked(overbooking({ start: at("15:00"), roomId: third.id }));

    expect(
      await overbook(
        world.receptionist,
        overbooking({ patientId: maria.id, start: at("15:00"), roomId: third.id }),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("moving an appointment to another room", () => {
  it("moves it to a room with space, and audits the change", async () => {
    const booked = await bookedForJuan();

    expect(await move(third.id, booked.id)).toEqual({ ok: true });

    expect(await rowOf(booked.id)).toMatchObject({ roomId: third.id });
    expect(await auditOf(booked.id)).toContainEqual(
      expect.objectContaining({
        action: "update",
        entityType: "appointment",
        patientId: maria.id,
        userId: world.receptionist.userId,
        before: { roomId: world.room.id },
        after: { roomId: third.id },
      }),
    );
  });

  it("is refused where the room is full, and leaves the appointment where it was", async () => {
    const booked = await bookedForJuan();

    expect(await move(world.otherRoom.id, booked.id)).toMatchObject({
      ok: false,
      reason: "roomFull",
      occupants: [{ practitionerName: "Lucía Díaz", kind: "schedule" }],
    });
    expect(await rowOf(booked.id)).toMatchObject({ roomId: world.room.id });
  });

  it("is refused to a room of another office", async () => {
    const booked = await bookedForJuan();
    const norte = await world.addOffice("Sede Norte");
    const norteRoom = await world.addRoom(norte.id, "Consultorio Norte");

    expect(await move(norteRoom.id, booked.id)).toEqual({ ok: false, reason: "otherOffice" });
  });
});

describe("who books sobreturnos and moves appointments", () => {
  it("lets a practitioner book only their own", async () => {
    expect(await overbook(world.juan.actor)).toMatchObject({ ok: true });
    expect(
      await overbook(world.lucia.actor, overbooking({ patientId: maria.id, start: at("13:00") })),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("refuses a member with no booking role", async () => {
    const nobody: Actor = { ...world.receptionist, roles: [] };
    const booked = await bookedForJuan();

    expect(await overbook(nobody)).toEqual({ ok: false, reason: "forbidden" });
    expect(await move(third.id, booked.id, nobody)).toEqual({ ok: false, reason: "forbidden" });
    expect(await move(third.id, booked.id, world.lucia.actor)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("writes the sobreturno to the audit log, about its patient", async () => {
    const created = await overbooked(overbooking());

    expect(await auditOf(created.id)).toEqual([
      expect.objectContaining({
        action: "create",
        patientId: pedro.id,
        after: expect.objectContaining({ roomId: world.room.id, overbooking: true }),
      }),
    ]);
  });
});

describe("the office day view", () => {
  it("lists the office's rooms and marks a sobreturno", async () => {
    await overbooked(overbooking({ start: at("15:00"), roomId: third.id }));

    const day = await asAppRole(db, (tx) =>
      getOfficeDay(world.receptionist, { officeId: world.office.id, date: "2099-01-05" }, tx),
    );

    expect(day.ok && day.rooms.map((room) => room.name)).toEqual([
      "Consultorio 1",
      "Consultorio 2",
      "Consultorio 3",
      "Consultorio 4",
    ]);
    expect(day.ok && day.columns[0]!.appointments).toEqual([
      expect.objectContaining({ overbooking: true, roomName: "Consultorio 3" }),
    ]);
  });
});
