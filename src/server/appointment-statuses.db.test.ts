import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { appointment, auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { StatusChangeInput } from "#/lib/appointments.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import {
  cancelAppointment,
  changeAppointmentStatus,
  undoAppointmentStatus,
} from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getAvailability } from "#/server/availability.ts";

// Every service call runs as the app role. The office is in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works there
// from 09:00 to 11:00. The clock is set to that morning, before the bookings.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanService: { id: string };
let maria: { id: string };
let pedro: { id: string };

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("11:00"));
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  await world.addSchedule({ practitionerId: world.juan.id });
  juanService = await world.addMedicalService(world.juan.id);
  maria = await world.addPatient("María", "0351 15 555-1234");
  pedro = await world.addPatient("Pedro", "0351 15 555-9876");
});

afterEach(async () => {
  vi.useRealTimers();
  await client.close();
});

async function book(patientId = maria.id, start = at("12:00")) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId,
        practitionerId: world.juan.id,
        medicalServiceId: juanService.id,
        start,
        durationMinutes: 30,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment.id;
}

function change(
  id: string,
  status: StatusChangeInput["status"],
  actor: Actor = world.receptionist,
) {
  return asAppRole(db, (tx) => changeAppointmentStatus(actor, { appointmentId: id, status }, tx));
}

function undo(id: string, actor: Actor = world.receptionist) {
  return asAppRole(db, (tx) => undoAppointmentStatus(actor, { appointmentId: id }, tx));
}

function cancel(id: string, actor: Actor = world.receptionist) {
  return asAppRole(db, (tx) =>
    cancelAppointment(
      actor,
      { appointmentId: id, cancelledBy: "patient", reason: "  Viaja  " },
      tx,
    ),
  );
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
          .select({ before: auditLog.before, after: auditLog.after, patientId: auditLog.patientId })
          .from(auditLog)
          .where(eq(auditLog.entityId, id))
          .orderBy(auditLog.createdAt),
      tx,
    ),
  );
}

async function juansFreeStarts() {
  const result = await asAppRole(db, (tx) =>
    getAvailability(
      world.receptionist,
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

describe("status changes", () => {
  it("confirms, checks in and marks attended, auditing each change", async () => {
    const id = await book();

    expect(await change(id, "confirmed")).toEqual({ ok: true });
    expect(await change(id, "checkedIn")).toEqual({ ok: true });
    vi.setSystemTime(at("12:40"));
    expect(await change(id, "attended", world.juan.actor)).toEqual({ ok: true });

    expect(await rowOf(id)).toMatchObject({
      status: "attended",
      previousStatus: "checkedIn",
      statusChangedAt: at("12:40"),
    });
    const changes = (await auditOf(id)).slice(1);
    expect(changes).toEqual([
      { before: { status: "booked" }, after: { status: "confirmed" }, patientId: maria.id },
      { before: { status: "confirmed" }, after: { status: "checkedIn" }, patientId: maria.id },
      { before: { status: "checkedIn" }, after: { status: "attended" }, patientId: maria.id },
    ]);
  });

  it("refuses a change the transitions do not allow, leaving the row", async () => {
    const id = await book();
    await change(id, "attended");

    expect(await change(id, "confirmed")).toEqual({ ok: false, reason: "notAllowed" });
    expect((await rowOf(id)).status).toBe("attended");
  });

  it("marks a no-show only after the start", async () => {
    const id = await book();

    expect(await change(id, "noShow")).toEqual({ ok: false, reason: "beforeStart" });
    vi.setSystemTime(at("12:01"));
    expect(await change(id, "noShow")).toEqual({ ok: true });
  });

  it("leaves check-in to reception, and another practitioner's appointments alone", async () => {
    const id = await book();

    expect(await change(id, "checkedIn", world.juan.actor)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await change(id, "confirmed", world.lucia.actor)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await change(id, "confirmed", world.juan.actor)).toEqual({ ok: true });
  });

  it("answers notFound for an unknown appointment", async () => {
    expect(await change(crypto.randomUUID(), "confirmed")).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("cancelling", () => {
  it("records who cancelled and why, and frees the time at once", async () => {
    const id = await book();
    expect(await juansFreeStarts()).not.toContain(at("12:00").toISOString());

    expect(await cancel(id, world.juan.actor)).toEqual({ ok: true });

    expect(await rowOf(id)).toMatchObject({
      status: "cancelled",
      cancelledBy: "patient",
      cancellationReason: "Viaja",
    });
    expect(await juansFreeStarts()).toContain(at("12:00").toISOString());
    expect((await auditOf(id)).at(-1)).toEqual({
      before: { status: "booked", cancelledBy: null, cancellationReason: null },
      after: { status: "cancelled", cancelledBy: "patient", cancellationReason: "Viaja" },
      patientId: maria.id,
    });
  });

  it("frees the time of a no-show too", async () => {
    const id = await book();
    vi.setSystemTime(at("12:10"));
    await change(id, "noShow");

    expect(await book(pedro.id)).toEqual(expect.any(String));
  });
});

describe("undo", () => {
  it("restores the previous status once, auditing the undo", async () => {
    const id = await book();
    await change(id, "confirmed");

    expect(await undo(id)).toEqual({ ok: true });
    expect(await rowOf(id)).toMatchObject({ status: "booked", previousStatus: null });
    expect((await auditOf(id)).at(-1)).toEqual({
      before: { status: "confirmed" },
      after: { status: "booked" },
      patientId: maria.id,
    });
    expect(await undo(id)).toEqual({ ok: false, reason: "nothingToUndo" });
  });

  it("is refused the next local day", async () => {
    const id = await book();
    await change(id, "confirmed");
    // 03:00Z on the 6th is midnight in Buenos Aires.
    vi.setSystemTime(at("03:00", "2099-01-06"));

    expect(await undo(id)).toEqual({ ok: false, reason: "tooLate" });
  });

  it("brings a cancellation back, clearing who cancelled", async () => {
    const id = await book();
    await cancel(id);

    expect(await undo(id)).toEqual({ ok: true });
    expect(await rowOf(id)).toMatchObject({
      status: "booked",
      cancelledBy: null,
      cancellationReason: null,
    });
  });

  it("refuses to bring a cancellation back once its time was taken", async () => {
    const id = await book();
    await cancel(id);
    await book(pedro.id);

    expect(await undo(id)).toEqual({ ok: false, reason: "timeTaken" });
    expect((await rowOf(id)).status).toBe("cancelled");
  });

  it("refuses to bring a cancellation back to a room filled since, naming who holds it", async () => {
    const luciaService = await world.addMedicalService(world.lucia.id);
    const overbook = async (
      practitionerId: string,
      medicalServiceId: string,
      patientId: string,
    ) => {
      const result = await asAppRole(db, (tx) =>
        bookOverbooking(
          world.receptionist,
          {
            patientId,
            practitionerId,
            medicalServiceId,
            start: at("15:00"),
            durationMinutes: 30,
            roomId: world.otherRoom.id,
          },
          tx,
        ),
      );
      if (!result.ok) {
        throw new Error(`bookOverbooking failed: ${result.reason}`);
      }
      return result.appointment.id;
    };
    const id = await overbook(world.juan.id, juanService.id, maria.id);
    await cancel(id);
    await overbook(world.lucia.id, luciaService.id, pedro.id);

    expect(await undo(id)).toEqual({
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
    expect((await rowOf(id)).status).toBe("cancelled");
  });

  it("is left to a role allowed to make the change", async () => {
    const id = await book();
    await change(id, "checkedIn");

    expect(await undo(id, world.juan.actor)).toEqual({ ok: false, reason: "forbidden" });
  });
});
