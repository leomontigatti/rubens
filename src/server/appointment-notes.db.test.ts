import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment, auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { editReceptionNote } from "#/server/appointment-notes.ts";
import { bookAppointment } from "#/server/appointments.ts";

// Every service call runs as the app role. 2099-01-05 is a Monday; Juan works
// from 09:00 to 11:00 in Buenos Aires (UTC-3), so 09:00 there is 12:00Z.

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let appointmentId: string;
let maria: { id: string };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
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

afterEach(async () => {
  await client.close();
});

function edit(receptionNote: string, actor: Actor = world.receptionist) {
  return asAppRole(db, (tx) => editReceptionNote(actor, { appointmentId, receptionNote }, tx));
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

describe("editing the reception note", () => {
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
