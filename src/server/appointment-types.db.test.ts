import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { AppointmentTypeInput } from "#/lib/appointment-types.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  createAppointmentType,
  listAppointmentTypes,
  setAppointmentTypeActive,
  updateAppointmentType,
} from "#/server/appointment-types.ts";
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

function firstVisit(overrides: Partial<AppointmentTypeInput> = {}): AppointmentTypeInput {
  return {
    practitionerId,
    name: "Primera consulta",
    durationMinutes: 40,
    color: "color1",
    ...overrides,
  };
}

function create(actor: Actor, input: AppointmentTypeInput = firstVisit()) {
  return asAppRole(db, (tx) => createAppointmentType(actor, input, tx));
}

async function created(actor: Actor = world.admin, input: AppointmentTypeInput = firstVisit()) {
  const result = await create(actor, input);
  if (!result.ok) {
    throw new Error(`createAppointmentType failed: ${result.reason}`);
  }
  return result.appointmentType;
}

async function typesOf(actor: Actor, includeInactive: boolean, id = practitionerId) {
  const result = await asAppRole(db, (tx) =>
    listAppointmentTypes(actor, { practitionerId: id, includeInactive }, tx),
  );
  if (!result.ok) {
    throw new Error(`listAppointmentTypes failed: ${result.reason}`);
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

describe("managing appointment types", () => {
  it("lets an admin create and edit a practitioner's types, listed by name", async () => {
    const first = await created();
    await created(world.admin, firstVisit({ name: "Control", durationMinutes: 20 }));
    const edited = await asAppRole(db, (tx) =>
      updateAppointmentType(
        world.admin,
        { appointmentTypeId: first.id, name: "Primera vez", durationMinutes: 45, color: "color2" },
        tx,
      ),
    );

    expect(edited).toMatchObject({
      ok: true,
      appointmentType: { name: "Primera vez", durationMinutes: 45, color: "color2", active: true },
    });
    const { appointmentTypes } = await typesOf(receptionist, false);
    expect(appointmentTypes.map((type) => type.name)).toEqual(["Control", "Primera vez"]);
  });

  it("lets a practitioner manage their own types and no one else's", async () => {
    const own = await create(practitioner);
    const others = await create(practitioner, firstVisit({ practitionerId: otherPractitionerId }));
    const othersType = await created(
      world.admin,
      firstVisit({ practitionerId: otherPractitionerId }),
    );
    const editOthers = await asAppRole(db, (tx) =>
      updateAppointmentType(
        practitioner,
        { appointmentTypeId: othersType.id, name: "Otro", durationMinutes: 30, color: "color1" },
        tx,
      ),
    );
    const deactivateOthers = await asAppRole(db, (tx) =>
      setAppointmentTypeActive(practitioner, { id: othersType.id, active: false }, tx),
    );

    expect(own.ok).toBe(true);
    expect(others).toEqual({ ok: false, reason: "forbidden" });
    expect(editOthers).toEqual({ ok: false, reason: "forbidden" });
    expect(deactivateOthers).toEqual({ ok: false, reason: "forbidden" });
    expect((await typesOf(practitioner, true)).canEdit).toBe(true);
    expect((await typesOf(practitioner, true, otherPractitionerId)).canEdit).toBe(false);
  });

  it("refuses a receptionist's changes, with a structured result", async () => {
    const type = await created();

    expect(await create(receptionist)).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await asAppRole(db, (tx) =>
        setAppointmentTypeActive(receptionist, { id: type.id, active: false }, tx),
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect((await typesOf(receptionist, true)).canEdit).toBe(false);
  });

  it("refuses a duration the availability module would not accept, or an unknown colour", async () => {
    for (const durationMinutes of [0, -15, 12.5, 721]) {
      expect(await create(world.admin, firstVisit({ durationMinutes }))).toEqual({
        ok: false,
        reason: "invalidInput",
      });
    }
    expect(
      await create(world.admin, { ...firstVisit(), color: "brandPink" } as unknown as never),
    ).toEqual({ ok: false, reason: "invalidInput" });
    expect((await created(world.admin, firstVisit({ durationMinutes: 720 }))).durationMinutes).toBe(
      720,
    );
  });

  it("refuses a type for an unknown or deactivated practitioner", async () => {
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

describe("deactivating a type", () => {
  it("drops it from the booking list and keeps it on the types screen", async () => {
    const type = await created();
    const result = await asAppRole(db, (tx) =>
      setAppointmentTypeActive(world.admin, { id: type.id, active: false }, tx),
    );

    expect(result).toEqual({ ok: true });
    expect((await typesOf(receptionist, false)).appointmentTypes).toEqual([]);
    expect((await typesOf(world.admin, true)).appointmentTypes).toMatchObject([
      { id: type.id, active: false },
    ]);
  });

  it("brings it back on reactivation", async () => {
    const type = await created();
    await asAppRole(db, (tx) =>
      setAppointmentTypeActive(world.admin, { id: type.id, active: false }, tx),
    );
    await asAppRole(db, (tx) =>
      setAppointmentTypeActive(world.admin, { id: type.id, active: true }, tx),
    );

    expect((await typesOf(receptionist, false)).appointmentTypes).toMatchObject([
      { id: type.id, active: true },
    ]);
  });
});

describe("auditing types", () => {
  it("records the creation, each edit and the deactivation", async () => {
    const type = await created(practitioner);
    await asAppRole(db, (tx) =>
      updateAppointmentType(
        world.admin,
        {
          appointmentTypeId: type.id,
          name: "Primera consulta",
          durationMinutes: 60,
          color: "color1",
        },
        tx,
      ),
    );
    await asAppRole(db, (tx) =>
      setAppointmentTypeActive(world.admin, { id: type.id, active: false }, tx),
    );

    const entries = await entriesFor(type.id);
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
        entityType: "appointmentType",
        userId: practitioner.userId,
        patientId: null,
        before: null,
        after: { practitionerId, name: "Primera consulta", durationMinutes: 40, color: "color1" },
      },
      {
        action: "update",
        entityType: "appointmentType",
        userId: world.admin.userId,
        patientId: null,
        before: { durationMinutes: 40 },
        after: { durationMinutes: 60 },
      },
      {
        action: "deactivate",
        entityType: "appointmentType",
        userId: world.admin.userId,
        patientId: null,
        before: { active: true },
        after: { active: false },
      },
    ]);
  });
});
