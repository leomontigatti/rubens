import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog, practitioner as practitionerTable } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { RescheduleInput, WarningConfirmation } from "#/lib/appointments.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { rescheduleAppointment } from "#/server/appointment-reschedule.ts";
import { cancelAppointment } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getAvailability } from "#/server/availability.ts";
import { setPatientActive } from "#/server/patients.ts";
import { setMemberActive } from "#/server/staff.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works from
// 09:00 to 11:00 in "Consultorio 1" at "Sede Centro", and from 14:00 to 16:00 in
// a room of "Sede Norte". "Lucía" works from 09:00 to 11:00 in "Consultorio 2".

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanService: { id: string };
let luciaService: { id: string };
let maria: { id: string };
let pedro: { id: string };
let northRoom: { id: string };

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  const north = await world.addOffice("Sede Norte");
  northRoom = await world.addRoom(north.id, "Norte 1");
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({
    practitionerId: world.juan.id,
    roomId: northRoom.id,
    startTime: "14:00",
    endTime: "16:00",
  });
  await world.addSchedule({ practitionerId: world.lucia.id, roomId: world.otherRoom.id });
  juanService = await world.addMedicalService(world.juan.id);
  luciaService = await world.addMedicalService(world.lucia.id);
  // A 15-minute grid, so a move can land over the appointment's own old time.
  await db
    .update(practitionerTable)
    .set({ gridMinutes: 15 })
    .where(eq(practitionerTable.id, world.juan.id));
  maria = await world.addPatient("María", "0351 15 555-1234");
  pedro = await world.addPatient("Pedro", "0351 15 555-9876");
});

afterEach(async () => {
  await client.close();
});

async function book(
  patientId: string,
  start: Date,
  practitioner: { id: string } = world.juan,
  serviceId = juanService.id,
) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId,
        practitionerId: practitioner.id,
        medicalServiceId: serviceId,
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

function reschedule(
  input: Omit<RescheduleInput, "durationMinutes"> & {
    durationMinutes?: number;
  } & WarningConfirmation,
  actor: Actor = world.receptionist,
) {
  return asAppRole(db, (tx) => rescheduleAppointment(actor, { durationMinutes: 30, ...input }, tx));
}

async function rowOf(id: string) {
  const [row] = await db.select().from(appointment).where(eq(appointment.id, id));
  return row!;
}

function auditOf(id: string) {
  return asAppRole(db, (tx) =>
    withTenant(
      world.admin,
      (tenant) =>
        tenant
          .select({ before: auditLog.before, after: auditLog.after })
          .from(auditLog)
          .where(eq(auditLog.entityId, id))
          .orderBy(auditLog.createdAt),
      tx,
    ),
  );
}

describe("rescheduling at a free time", () => {
  it("moves the same appointment over its own old time, auditing the previous values", async () => {
    const id = await book(maria.id, at("12:00"));

    expect(await reschedule({ appointmentId: id, start: at("12:15") })).toEqual({ ok: true });

    expect((await rowOf(id)).during).toEqual({ start: at("12:15"), end: at("12:45") });
    expect((await auditOf(id)).at(-1)).toEqual({
      before: { start: at("12:00").toISOString(), end: at("12:30").toISOString() },
      after: { start: at("12:15").toISOString(), end: at("12:45").toISOString() },
    });
  });

  it("moves it to another office, in the room of the schedule there", async () => {
    const id = await book(maria.id, at("12:00"));

    expect(await reschedule({ appointmentId: id, start: at("17:00") })).toEqual({ ok: true });

    expect((await rowOf(id)).roomId).toBe(northRoom.id);
    expect((await auditOf(id)).at(-1)!.before).toMatchObject({ roomId: world.room.id });
  });

  it("refuses a time that is not free, leaving the appointment", async () => {
    const id = await book(maria.id, at("12:00"));
    await book(pedro.id, at("13:00"));

    expect(await reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "notFree",
    });
    expect((await rowOf(id)).during.start).toEqual(at("12:00"));
  });

  it("warns about the patient's other appointments that day, not about itself", async () => {
    const id = await book(maria.id, at("12:00"));
    await book(maria.id, at("12:00"), world.lucia, luciaService.id);

    const warned = await reschedule({ appointmentId: id, start: at("13:00") });
    expect(warned).toMatchObject({ ok: false, reason: "patientWarning" });
    expect(warned.ok === false && warned.reason === "patientWarning" && warned.warnings).toEqual([
      expect.objectContaining({ kind: "sameDay", practitionerName: "Lucía Díaz" }),
    ]);
    expect(
      await reschedule({ appointmentId: id, start: at("13:00"), confirmWarnings: true }),
    ).toEqual({ ok: true });
  });

  it("offers the appointment's own time among the free times when asked to", async () => {
    const id = await book(maria.id, at("12:00"));
    const freeStarts = async (appointmentId?: string) => {
      const result = await asAppRole(db, (tx) =>
        getAvailability(
          world.receptionist,
          {
            practitionerId: world.juan.id,
            firstDate: "2099-01-05",
            lastDate: "2099-01-05",
            durationMinutes: 30,
            appointmentId,
          },
          tx,
        ),
      );
      return result.ok ? result.freeStarts.map((free) => +free.start) : [];
    };

    expect(await freeStarts()).not.toContain(+at("12:15"));
    expect(await freeStarts(id)).toContain(+at("12:15"));
  });
});

describe("rescheduling as an overbooking", () => {
  it("goes over another appointment and is marked an overbooking", async () => {
    const id = await book(maria.id, at("12:00"));
    await book(pedro.id, at("13:00"));

    expect(await reschedule({ appointmentId: id, start: at("13:00"), overbooking: true })).toEqual({
      ok: true,
    });
    expect(await rowOf(id)).toMatchObject({ overbooking: true, roomId: world.room.id });
  });

  it("outside the schedules, needs a room with space", async () => {
    const id = await book(maria.id, at("12:00"));

    expect(
      await reschedule({ appointmentId: id, start: at("12:00"), overbooking: true, roomId: null }),
    ).toMatchObject({ ok: true });
    expect(await reschedule({ appointmentId: id, start: at("19:00"), overbooking: true })).toEqual({
      ok: false,
      reason: "roomRequired",
    });
    expect(
      await reschedule({
        appointmentId: id,
        start: at("12:00"),
        overbooking: true,
        roomId: world.otherRoom.id,
      }),
    ).toMatchObject({ ok: false, reason: "roomFull" });
  });
});

describe("who and what can be rescheduled", () => {
  it("refuses the appointment of a deactivated patient, or practitioner", async () => {
    const id = await book(maria.id, at("12:00"));

    await asAppRole(db, (tx) => setPatientActive(world.admin, { id: maria.id, active: false }, tx));
    expect(await reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "patientInactive",
    });

    await asAppRole(db, (tx) => setPatientActive(world.admin, { id: maria.id, active: true }, tx));
    await asAppRole(db, (tx) =>
      setMemberActive(world.admin, { memberId: world.juan.memberId, active: false }, tx),
    );
    expect(await reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "practitionerInactive",
    });
  });

  it("refuses a cancelled appointment", async () => {
    const id = await book(maria.id, at("12:00"));
    await asAppRole(db, (tx) =>
      cancelAppointment(world.receptionist, { appointmentId: id, cancelledBy: "business" }, tx),
    );

    expect(await reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("refuses another practitioner, and lets the appointment's own reschedule it", async () => {
    const id = await book(maria.id, at("12:00"));

    expect(await reschedule({ appointmentId: id, start: at("13:00") }, world.lucia.actor)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await reschedule({ appointmentId: id, start: at("13:00") }, world.juan.actor)).toEqual({
      ok: true,
    });
  });
});
