import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { getAppointment, updateAppointment } from "#/server/appointment-edit.ts";
import { bookAppointment } from "#/server/appointments.ts";

// Every service call runs as the app role. 2099-01-05 is a Monday; Juan works
// from 09:00 to 11:00 in Buenos Aires (UTC-3), so 09:00 there is 12:00Z.

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let world: BookingWorld;
let appointmentId: string;
let maria: { id: string };

beforeEach(async () => {
  db = await testDatabase.reset();
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  const service = await world.addMedicalService(world.juan.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        medicalServiceId: service.id,
        start: new Date("2099-01-05T12:00:00Z"),
        durationMinutes: 30,
        receptionNote: "Trae estudios",
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  appointmentId = result.appointment.id;
});

/** Saves the appointment with `receptionNote`, in the room it is in unless `roomId`. */
function edit(receptionNote: string, actor: Actor = world.receptionist, roomId = world.room.id) {
  return asAppRole(db, (tx) =>
    updateAppointment(actor, { appointmentId, roomId, receptionNote }, tx),
  );
}

function read(actor: Actor = world.receptionist) {
  return asAppRole(db, (tx) => getAppointment(actor, { appointmentId }, tx));
}

async function roomOf() {
  const [row] = await db
    .select({ roomId: appointment.roomId })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return row!.roomId;
}

async function noteOf() {
  const [row] = await db
    .select({ receptionNote: appointment.receptionNote })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return row!.receptionNote;
}

function auditOf() {
  return asAppRole(db, (tx) =>
    withTenant(
      world.admin,
      (tenant) =>
        tenant
          .select({ before: auditLog.before, after: auditLog.after, patientId: auditLog.patientId })
          .from(auditLog)
          .where(eq(auditLog.entityId, appointmentId))
          .orderBy(auditLog.createdAt),
      tx,
    ),
  );
}

describe("saving the reception note", () => {
  it("changes the note and audits it about the patient, before and after", async () => {
    expect(await edit("  Llega tarde  ")).toEqual({ ok: true });

    expect(await noteOf()).toBe("Llega tarde");
    expect((await auditOf()).at(-1)).toEqual({
      before: { receptionNote: "Trae estudios" },
      after: { receptionNote: "Llega tarde" },
      patientId: maria.id,
    });
  });

  it("clears the note when left empty", async () => {
    expect(await edit("   ")).toEqual({ ok: true });

    expect(await noteOf()).toBeNull();
  });

  it("is left to whoever may book for the practitioner", async () => {
    expect(await edit("Otra", world.lucia.actor)).toEqual({ ok: false, reason: "forbidden" });
    expect(await edit("Propia", world.juan.actor)).toEqual({ ok: true });
    expect(await noteOf()).toBe("Propia");
  });
});

describe("reading one appointment", () => {
  it("draws it as the calendar does, with its office's zone and rooms", async () => {
    const result = await read();

    expect(result).toMatchObject({
      ok: true,
      appointment: {
        id: appointmentId,
        patientName: expect.stringContaining("María"),
        roomId: world.room.id,
        receptionNote: "Trae estudios",
        status: "booked",
      },
      office: {
        timeZone: "America/Argentina/Buenos_Aires",
        rooms: [
          { id: world.room.id, name: "Consultorio 1" },
          { id: world.otherRoom.id, name: "Consultorio 2" },
        ],
      },
    });
  });

  it("lists its own room though deactivated, and no other inactive room", async () => {
    await db.update(room).set({ active: false });

    expect(await read()).toMatchObject({
      ok: true,
      office: { rooms: [{ id: world.room.id, name: "Consultorio 1" }] },
    });
  });

  it("is its own practitioner's, and not another practitioner's", async () => {
    expect(await read(world.juan.actor)).toMatchObject({ ok: true });
    expect(await read(world.lucia.actor)).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("saving the room and the note together", () => {
  it("moves it to a room with space and changes the note", async () => {
    expect(await edit("Llega tarde", world.receptionist, world.otherRoom.id)).toEqual({ ok: true });

    expect(await roomOf()).toBe(world.otherRoom.id);
    expect(await noteOf()).toBe("Llega tarde");
  });

  it("keeps the note as it was when the room is refused", async () => {
    await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });

    expect(await edit("Llega tarde", world.receptionist, world.otherRoom.id)).toMatchObject({
      ok: false,
      reason: "roomFull",
    });
    expect(await roomOf()).toBe(world.room.id);
    expect(await noteOf()).toBe("Trae estudios");
  });
});
