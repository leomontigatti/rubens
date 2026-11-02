import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Transaction } from "#/db/tenant.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  insertRow,
  lostRoomRace,
  updateRow,
  writeMovedRow,
  writeNewRow,
  writeRoomChange,
  writeStatusRow,
} from "#/server/appointment-placement-steps.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import { changeAppointmentStatus, undoAppointmentStatus } from "#/server/appointment-statuses.ts";
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

/** The row a booking of `who`'s would write, over the checks that would refuse it. */
function newRow(who: "juan" | "lucia", patientId: string, start: Date, roomId: string) {
  return {
    organizationId: world.admin.organizationId,
    createdBy: world.admin.userId,
    patientId,
    practitionerId: world[who].id,
    medicalServiceId: who === "juan" ? juanService.id : luciaService.id,
    roomId,
    during: { start, end: new Date(+start + 30 * 60_000) },
  };
}

/** The practitioner as `findBookablePractitioner` hands them over, on the default grid. */
function bookable(who: "juan" | "lucia") {
  return { id: world[who].id, gridMinutes: 30 };
}

function isoStarts(refused: unknown) {
  const { freeStarts } = refused as { freeStarts: { start: Date }[] };
  return freeStarts.map(({ start }) => start.toISOString());
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

describe("the database guarantee against double booking", () => {
  let first: typeof appointment.$inferSelect;

  beforeEach(async () => {
    first = await booked("juan", maria.id, at("12:00"));
  });

  function insertOver(values: Partial<typeof appointment.$inferInsert>) {
    return asTenant((tenant) =>
      insertRow(tenant, {
        ...first,
        id: undefined,
        during: { start: at("12:15"), end: at("12:45") },
        ...values,
      }),
    );
  }

  it("turns an overlap with an active appointment into the practitioner's constraint", async () => {
    expect(await insertOver({})).toEqual({ ok: false, constraint: "practitioner" });
  });

  it("turns another practitioner's overlap in the same room into the room's constraint, overbooking or not", async () => {
    const lucias = { practitionerId: world.lucia.id, medicalServiceId: luciaService.id };

    expect(await insertOver(lucias)).toEqual({ ok: false, constraint: "room" });
    expect(await insertOver({ ...lucias, overbooking: true })).toEqual({
      ok: false,
      constraint: "room",
    });
    expect(await insertOver({ ...lucias, roomId: world.otherRoom.id })).toMatchObject({
      ok: true,
    });
  });

  it("lets an overbooking and a cancelled appointment overlap", async () => {
    expect(await insertOver({ overbooking: true })).toMatchObject({ ok: true });
    await db.delete(appointment).where(eq(appointment.overbooking, true));
    expect(await insertOver({ status: "cancelled", cancelledBy: "patient" })).toMatchObject({
      ok: true,
    });
  });
});

describe("a free start that loses the race", () => {
  const timeZone = "America/Argentina/Buenos_Aires";

  it("on the practitioner's constraint is time taken, with the free times of the local day", async () => {
    // Monday evening runs past midnight UTC, and Tuesday is another local day.
    await world.addSchedule({
      practitionerId: world.juan.id,
      startTime: "20:30",
      endTime: "21:30",
    });
    await world.addSchedule({
      practitionerId: world.juan.id,
      weekdays: [2],
      firstDate: "2099-01-06",
    });
    await booked("juan", maria.id, at("12:00"));

    const refused = await asTenant((tenant) =>
      writeNewRow(
        tenant,
        bookable("juan"),
        "freeStart",
        newRow("juan", pedro.id, at("12:15"), world.room.id),
        timeZone,
      ),
    );

    expect(refused).toMatchObject({ ok: false, reason: "timeTaken" });
    expect(isoStarts(refused)).toEqual([
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T13:00:00.000Z",
      "2099-01-05T13:30:00.000Z",
      "2099-01-05T23:30:00.000Z",
      "2099-01-06T00:00:00.000Z",
    ]);
  });

  it("on the room's constraint is time taken too, with the free times, not an empty list", async () => {
    await booked("juan", maria.id, at("12:00"));

    const refused = await asTenant((tenant) =>
      writeNewRow(
        tenant,
        bookable("lucia"),
        "freeStart",
        newRow("lucia", pedro.id, at("12:00"), world.room.id),
        timeZone,
      ),
    );

    expect(refused).toMatchObject({ ok: false, reason: "timeTaken" });
    expect(isoStarts(refused)).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T13:00:00.000Z",
      "2099-01-05T13:30:00.000Z",
    ]);
  });
});

describe("an overbooking that loses the race", () => {
  it("on the room's constraint is refused as room full, naming who took the room", async () => {
    await booked("juan", maria.id, at("12:00"));

    expect(
      await asTenant((tenant) =>
        writeNewRow(
          tenant,
          bookable("lucia"),
          "overbooking",
          { ...newRow("lucia", pedro.id, at("12:00"), world.room.id), overbooking: true },
          "America/Argentina/Buenos_Aires",
        ),
      ),
    ).toEqual({
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
    expect(await db.select().from(appointment)).toHaveLength(1);
  });
});

describe("a move to a new time that loses the race", () => {
  const timeZone = "America/Argentina/Buenos_Aires";

  it("as a free start on the practitioner's constraint is time taken, its own time counted free", async () => {
    await booked("juan", maria.id, at("12:00"));
    const moved = await booked("juan", pedro.id, at("12:30"));

    const refused = await asTenant((tenant) =>
      writeMovedRow(
        tenant,
        bookable("juan"),
        "freeStart",
        moved.id,
        {
          during: { start: at("12:15"), end: at("12:45") },
          roomId: world.room.id,
          overbooking: false,
        },
        timeZone,
      ),
    );

    expect(refused).toMatchObject({ ok: false, reason: "timeTaken" });
    expect(isoStarts(refused)).toEqual([
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T13:00:00.000Z",
      "2099-01-05T13:30:00.000Z",
    ]);
    expect((await rowOf(moved.id)).during.start).toEqual(at("12:30"));
  });

  it("as a free start on the room's constraint is time taken too, with the free times", async () => {
    await booked("juan", maria.id, at("12:00"));
    const moved = await booked("lucia", pedro.id, at("12:00"));

    const refused = await asTenant((tenant) =>
      writeMovedRow(
        tenant,
        bookable("lucia"),
        "freeStart",
        moved.id,
        {
          during: { start: at("12:00"), end: at("12:30") },
          roomId: world.room.id,
          overbooking: false,
        },
        timeZone,
      ),
    );

    expect(refused).toMatchObject({ ok: false, reason: "timeTaken" });
    expect(isoStarts(refused)).toEqual([
      "2099-01-05T12:00:00.000Z",
      "2099-01-05T12:30:00.000Z",
      "2099-01-05T13:00:00.000Z",
      "2099-01-05T13:30:00.000Z",
    ]);
  });

  it("as an overbooking on the room's constraint is room full, naming who took the room", async () => {
    await booked("juan", maria.id, at("12:00"));
    const moved = await booked("lucia", pedro.id, at("13:00"));

    expect(
      await asTenant((tenant) =>
        writeMovedRow(
          tenant,
          bookable("lucia"),
          "overbooking",
          moved.id,
          {
            during: { start: at("12:00"), end: at("12:30") },
            roomId: world.room.id,
            overbooking: true,
          },
          timeZone,
        ),
      ),
    ).toEqual({
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
    expect(await rowOf(moved.id)).toMatchObject({
      roomId: world.otherRoom.id,
      overbooking: false,
    });
  });
});

describe("an undo that loses the race", () => {
  const undone = {
    status: "booked",
    previousStatus: null,
    cancelledBy: null,
    cancellationReason: null,
  } as const;

  async function cancelled(id: string) {
    await db
      .update(appointment)
      .set({ status: "cancelled", previousStatus: "booked", cancelledBy: "patient" })
      .where(eq(appointment.id, id));
    return rowOf(id);
  }

  it("on the room's constraint is room full, naming who took the room, and stays cancelled", async () => {
    const juans = await cancelled((await booked("juan", maria.id, at("12:00"))).id);
    const lucias = await booked("lucia", pedro.id, at("12:00"));
    await db
      .update(appointment)
      .set({ roomId: world.room.id })
      .where(eq(appointment.id, lucias.id));

    expect(await asTenant((tenant) => writeStatusRow(tenant, juans, undone))).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        {
          practitionerName: "Lucía Díaz",
          kind: "appointment",
          start: at("12:00"),
          end: at("12:30"),
        },
      ],
    });
    expect(await rowOf(juans.id)).toMatchObject({ status: "cancelled" });
  });

  it("on the practitioner's constraint is time taken, with no free times, and stays cancelled", async () => {
    const juans = await cancelled((await booked("juan", maria.id, at("12:00"))).id);
    await booked("juan", pedro.id, at("12:00"));

    expect(await asTenant((tenant) => writeStatusRow(tenant, juans, undone))).toEqual({
      ok: false,
      reason: "timeTaken",
    });
    expect(await rowOf(juans.id)).toMatchObject({ status: "cancelled" });
  });
});

describe("a status change that holds time all along", () => {
  it("checks no room space, in a room deactivated since", async () => {
    const juans = await booked("juan", maria.id, at("12:00"));
    await db.update(room).set({ active: false }).where(eq(room.id, world.room.id));

    expect(
      await asAppRole(db, (tx) =>
        changeAppointmentStatus(
          world.receptionist,
          { appointmentId: juans.id, status: "confirmed" },
          tx,
        ),
      ),
    ).toEqual({ ok: true });
    expect(
      await asAppRole(db, (tx) =>
        undoAppointmentStatus(world.receptionist, { appointmentId: juans.id }, tx),
      ),
    ).toEqual({ ok: true });
  });
});

describe("the audit entry of a new appointment", () => {
  async function afterOf(id: string) {
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    return entry!.after;
  }

  const span = { start: "2099-01-05T12:00:00.000Z", end: "2099-01-05T12:30:00.000Z" };

  it("leaves `overbooking` out of a booking", async () => {
    const created = await booked("juan", maria.id, at("12:00"));

    expect(await afterOf(created.id)).toEqual({
      patientId: maria.id,
      practitionerId: world.juan.id,
      medicalServiceId: juanService.id,
      roomId: world.room.id,
      receptionNote: null,
      ...span,
      status: "booked",
    });
  });

  it("carries `overbooking` on an overbooking", async () => {
    const result = await asAppRole(db, (tx) =>
      bookOverbooking(
        world.receptionist,
        {
          patientId: maria.id,
          practitionerId: world.juan.id,
          medicalServiceId: juanService.id,
          start: at("12:00"),
          durationMinutes: 30,
        },
        tx,
      ),
    );
    if (!result.ok) {
      throw new Error(`bookOverbooking failed: ${result.reason}`);
    }

    expect(await afterOf(result.appointment.id)).toEqual({
      patientId: maria.id,
      practitionerId: world.juan.id,
      medicalServiceId: juanService.id,
      roomId: world.room.id,
      overbooking: true,
      receptionNote: null,
      ...span,
      status: "booked",
    });
  });
});
