import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { MedicalServiceInput } from "#/lib/medical-services.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  createMedicalService,
  listMedicalServices,
  setMedicalServiceActive,
  updateMedicalService,
} from "#/server/medical-services.ts";
import { listSchedulePractitioners } from "#/server/schedules.ts";
import { setMemberActive } from "#/server/staff.ts";

// Every service call runs as the app role, so row-level security applies as in
// the app.

let client: PGlite;
let db: TestDatabase;
let world: Awaited<ReturnType<typeof createSchedulingWorld>>;
let practitioner: Actor;
let practitionerId: string;
let otherPractitionerId: string;
let receptionist: Actor;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createSchedulingWorld(db);
  practitioner = (await world.addStaff("Juan Gómez")).actor;
  await world.addStaff("Ana Ruiz");
  receptionist = (await world.addStaff("Rita Paz", ["receptionist"])).actor;
  const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
  practitionerId = listed.find((row) => row.displayName === "Juan Gómez")!.id;
  otherPractitionerId = listed.find((row) => row.displayName === "Ana Ruiz")!.id;
});

afterEach(async () => {
  await client.close();
});

function firstVisit(overrides: Partial<MedicalServiceInput> = {}): MedicalServiceInput {
  return {
    practitionerId,
    name: "Primera consulta",
    durationMinutes: 40,
    color: "color1",
    ...overrides,
  };
}

function create(actor: Actor, input: MedicalServiceInput = firstVisit()) {
  return asAppRole(db, (tx) => createMedicalService(actor, input, tx));
}

async function created(actor: Actor = world.admin, input: MedicalServiceInput = firstVisit()) {
  const result = await create(actor, input);
  if (!result.ok) {
    throw new Error(`createMedicalService failed: ${result.reason}`);
  }
  return result.medicalService;
}

async function typesOf(actor: Actor, includeInactive: boolean, id = practitionerId) {
  const result = await asAppRole(db, (tx) =>
    listMedicalServices(actor, { practitionerId: id, includeInactive }, tx),
  );
  if (!result.ok) {
    throw new Error(`listMedicalServices failed: ${result.reason}`);
  }
  return result;
}

async function entriesFor(entityId: string) {
  return asAppRole(db, (tx) =>
    withTenant(
      world.admin,
      (tenant) => tenant.select().from(auditLog).where(eq(auditLog.entityId, entityId)),
      tx,
    ),
  );
}

describe("managing medical services", () => {
  it("lets an admin create and edit a practitioner's medical services, listed by name", async () => {
    const first = await created();
    await created(world.admin, firstVisit({ name: "Control", durationMinutes: 20 }));
    const edited = await asAppRole(db, (tx) =>
      updateMedicalService(
        world.admin,
        { medicalServiceId: first.id, name: "Primera vez", durationMinutes: 45, color: "color2" },
        tx,
      ),
    );

    expect(edited).toMatchObject({
      ok: true,
      medicalService: { name: "Primera vez", durationMinutes: 45, color: "color2", active: true },
    });
    const { medicalServices } = await typesOf(receptionist, false);
    expect(medicalServices.map((service) => service.name)).toEqual(["Control", "Primera vez"]);
  });

  it("lets a practitioner manage their own medical services and no one else's", async () => {
    const own = await create(practitioner);
    const others = await create(practitioner, firstVisit({ practitionerId: otherPractitionerId }));
    const othersType = await created(
      world.admin,
      firstVisit({ practitionerId: otherPractitionerId }),
    );
    const editOthers = await asAppRole(db, (tx) =>
      updateMedicalService(
        practitioner,
        { medicalServiceId: othersType.id, name: "Otro", durationMinutes: 30, color: "color1" },
        tx,
      ),
    );
    const deactivateOthers = await asAppRole(db, (tx) =>
      setMedicalServiceActive(practitioner, { id: othersType.id, active: false }, tx),
    );

    expect(own.ok).toBe(true);
    expect(others).toEqual({ ok: false, reason: "forbidden" });
    expect(editOthers).toEqual({ ok: false, reason: "forbidden" });
    expect(deactivateOthers).toEqual({ ok: false, reason: "forbidden" });
    expect((await typesOf(practitioner, true)).canEdit).toBe(true);
    expect((await typesOf(practitioner, true, otherPractitionerId)).canEdit).toBe(false);
  });

  it("refuses a receptionist's changes, with a structured result", async () => {
    const service = await created();

    expect(await create(receptionist)).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await asAppRole(db, (tx) =>
        setMedicalServiceActive(receptionist, { id: service.id, active: false }, tx),
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect((await typesOf(receptionist, true)).canEdit).toBe(false);
  });

  it("saves the longest duration, which the database's check allows too", async () => {
    expect((await created(world.admin, firstVisit({ durationMinutes: 720 }))).durationMinutes).toBe(
      720,
    );
  });

  it("refuses a medical service for an unknown or deactivated practitioner", async () => {
    const staff = await world.addStaff("Pedro Sosa");
    const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
    const pedroId = listed.find((row) => row.displayName === "Pedro Sosa")!.id;
    await asAppRole(db, (tx) =>
      setMemberActive(world.admin, { memberId: staff.member.memberId, active: false }, tx),
    );

    expect(await create(world.admin, firstVisit({ practitionerId: crypto.randomUUID() }))).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await create(world.admin, firstVisit({ practitionerId: pedroId }))).toEqual({
      ok: false,
      reason: "practitionerInactive",
    });
  });
});

describe("deactivating a medical service", () => {
  it("drops it from the booking list and keeps it on the medical services screen", async () => {
    const service = await created();
    const result = await asAppRole(db, (tx) =>
      setMedicalServiceActive(world.admin, { id: service.id, active: false }, tx),
    );

    expect(result).toEqual({ ok: true });
    expect((await typesOf(receptionist, false)).medicalServices).toEqual([]);
    expect((await typesOf(world.admin, true)).medicalServices).toMatchObject([
      { id: service.id, active: false },
    ]);
  });

  it("brings it back on reactivation", async () => {
    const service = await created();
    await asAppRole(db, (tx) =>
      setMedicalServiceActive(world.admin, { id: service.id, active: false }, tx),
    );
    await asAppRole(db, (tx) =>
      setMedicalServiceActive(world.admin, { id: service.id, active: true }, tx),
    );

    expect((await typesOf(receptionist, false)).medicalServices).toMatchObject([
      { id: service.id, active: true },
    ]);
  });
});

describe("auditing medical services", () => {
  it("records the creation, each edit and the deactivation", async () => {
    const service = await created(practitioner);
    await asAppRole(db, (tx) =>
      updateMedicalService(
        world.admin,
        {
          medicalServiceId: service.id,
          name: "Primera consulta",
          durationMinutes: 60,
          color: "color1",
        },
        tx,
      ),
    );
    await asAppRole(db, (tx) =>
      setMedicalServiceActive(world.admin, { id: service.id, active: false }, tx),
    );

    const entries = await entriesFor(service.id);
    expect(
      entries.map(({ action, entityType, userId, patientId, before, after }) => ({
        action,
        entityType,
        userId,
        patientId,
        before,
        after,
      })),
    ).toEqual([
      {
        action: "create",
        entityType: "medicalService",
        userId: practitioner.userId,
        patientId: null,
        before: null,
        after: { practitionerId, name: "Primera consulta", durationMinutes: 40, color: "color1" },
      },
      {
        action: "update",
        entityType: "medicalService",
        userId: world.admin.userId,
        patientId: null,
        before: { durationMinutes: 40 },
        after: { durationMinutes: 60 },
      },
      {
        action: "deactivate",
        entityType: "medicalService",
        userId: world.admin.userId,
        patientId: null,
        before: { active: true },
        after: { active: false },
      },
    ]);
  });
});
