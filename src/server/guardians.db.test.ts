import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { guardian } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import type { GuardianInput } from "#/lib/guardians.ts";
import { createOrganization } from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  addGuardian,
  listGuardians,
  removeGuardian,
  setMessageContact,
  updateGuardian,
} from "#/server/guardians.ts";
import {
  getPatient,
  getPatientHistory,
  registerPatient,
  updatePatient,
} from "#/server/patients.ts";

// Every call runs as the app role, so row-level security applies as in the app.

let client: PGlite;
let db: TestDatabase;
let admin: Actor;
let receptionist: Actor;
let practitioner: Actor;
let patientId: string;

const patientFields = { firstName: "Tomás", lastName: "Pérez", phone: "0351 15 555-1234" };

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  const { organizationId, adminUserId } = await createOrganization(createAuth(db));
  admin = { organizationId, userId: adminUserId, roles: ["admin"] };
  receptionist = { organizationId, userId: "receptionist", roles: ["receptionist"] };
  practitioner = { organizationId, userId: "practitioner", roles: ["practitioner"] };
  const registered = await asAppRole(db, (tx) => registerPatient(receptionist, patientFields, tx));
  if (!registered.ok) {
    throw new Error(`registerPatient failed: ${registered.reason}`);
  }
  patientId = registered.patient.id;
});

afterEach(async () => {
  vi.useRealTimers();
  await client.close();
});

async function add(actor: Actor, input: Partial<GuardianInput> = {}) {
  const result = await asAppRole(db, (tx) =>
    addGuardian(
      actor,
      { patientId, name: "Laura Gómez", relationship: "Madre", phone: "351 4123456", ...input },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`addGuardian failed: ${result.reason}`);
  }
  return result.guardian;
}

async function guardians(actor: Actor = receptionist) {
  const result = await asAppRole(db, (tx) => listGuardians(actor, { patientId }, tx));
  if (!result.ok) {
    throw new Error(`listGuardians failed: ${result.reason}`);
  }
  return result.guardians;
}

async function contact(guardianId: string | null, actor: Actor = receptionist) {
  return asAppRole(db, (tx) => setMessageContact(actor, { patientId, guardianId }, tx));
}

async function contactName() {
  return (await guardians()).find((row) => row.messageContact)?.name ?? null;
}

async function history(entityType: string) {
  const result = await asAppRole(db, (tx) => getPatientHistory(admin, { patientId }, tx));
  if (!result.ok) {
    throw new Error(`getPatientHistory failed: ${result.reason}`);
  }
  return result.entries
    .filter((entry) => entry.entityType === entityType)
    .map(({ action, userId, before, after }) => ({ action, userId, before, after }))
    .reverse();
}

describe("a patient's guardians", () => {
  it("lets receptionists, admins and practitioners add guardians, the phone read as a patient's", async () => {
    const mother = await add(receptionist, {
      documentType: "dni",
      documentNumber: "28.123.456",
      email: "laura@example.com",
    });
    await add(admin, { name: "Pedro Pérez", relationship: "Padre", phone: "+34 612 345 678" });
    await add(practitioner, { name: "Ana Pérez", relationship: "Abuela" });

    expect(mother).toEqual({
      id: expect.any(String),
      patientId,
      name: "Laura Gómez",
      relationship: "Madre",
      documentType: "dni",
      documentNumber: "28123456",
      phone: "+543514123456",
      email: "laura@example.com",
      messageContact: false,
    });
    expect((await guardians()).map(({ name, phone }) => ({ name, phone }))).toEqual([
      { name: "Laura Gómez", phone: "+543514123456" },
      { name: "Pedro Pérez", phone: "+34612345678" },
      { name: "Ana Pérez", phone: "+543514123456" },
    ]);
  });

  it("refuses a phone that is not a number, or has no area code", async () => {
    for (const phone of ["123", "4123456"]) {
      expect(
        await asAppRole(db, (tx) =>
          addGuardian(receptionist, { patientId, name: "Laura", relationship: "Madre", phone }, tx),
        ),
      ).toEqual({ ok: false, reason: "invalidInput" });
    }
  });

  it("edits a guardian's fields", async () => {
    const added = await add(receptionist, { email: "laura@example.com" });

    const result = await asAppRole(db, (tx) =>
      updateGuardian(
        practitioner,
        {
          guardianId: added.id,
          name: "Laura Gómez",
          relationship: "Tutora",
          phone: "0351 15 444-1111",
          email: "",
        },
        tx,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      guardian: { relationship: "Tutora", phone: "+5493514441111", email: null },
    });
  });

  it("removes a guardian", async () => {
    const added = await add(receptionist);
    const other = await add(receptionist, { name: "Pedro Pérez" });

    expect(
      await asAppRole(db, (tx) => removeGuardian(receptionist, { guardianId: added.id }, tx)),
    ).toEqual({ ok: true });
    expect((await guardians()).map((row) => row.id)).toEqual([other.id]);
  });

  it("refuses guardian changes to a member with none of the roles", async () => {
    const added = await add(receptionist);
    const nobody: Actor = { ...receptionist, userId: "nobody", roles: [] };
    const fields = { name: "Laura", relationship: "Madre", phone: "351 4123456" };

    for (const result of [
      await asAppRole(db, (tx) => listGuardians(nobody, { patientId }, tx)),
      await asAppRole(db, (tx) => addGuardian(nobody, { ...fields, patientId }, tx)),
      await asAppRole(db, (tx) => updateGuardian(nobody, { ...fields, guardianId: added.id }, tx)),
      await asAppRole(db, (tx) => removeGuardian(nobody, { guardianId: added.id }, tx)),
      await contact(added.id, nobody),
    ]) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("answers notFound for a patient or a guardian that is not there", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const fields = { name: "Laura", relationship: "Madre", phone: "351 4123456" };

    for (const result of [
      await asAppRole(db, (tx) => listGuardians(receptionist, { patientId: missing }, tx)),
      await asAppRole(db, (tx) => addGuardian(receptionist, { ...fields, patientId: missing }, tx)),
      await asAppRole(db, (tx) =>
        updateGuardian(receptionist, { ...fields, guardianId: missing }, tx),
      ),
      await asAppRole(db, (tx) => removeGuardian(receptionist, { guardianId: missing }, tx)),
      await contact(missing),
    ]) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
  });
});

describe("the message contact", () => {
  it("is the patient until a guardian is chosen, and is one guardian at most", async () => {
    const mother = await add(receptionist);
    const father = await add(receptionist, { name: "Pedro Pérez", relationship: "Padre" });
    expect(await contactName()).toBeNull();

    expect(await contact(mother.id)).toEqual({ ok: true });
    expect(await contactName()).toBe("Laura Gómez");

    expect(await contact(father.id, practitioner)).toEqual({ ok: true });
    expect((await guardians()).filter((row) => row.messageContact).map((row) => row.id)).toEqual([
      father.id,
    ]);

    expect(await contact(null, admin)).toEqual({ ok: true });
    expect(await contactName()).toBeNull();
  });

  it("refuses another patient's guardian", async () => {
    const other = await asAppRole(db, (tx) =>
      registerPatient(
        receptionist,
        { firstName: "Lucía", lastName: "Paz", phone: "0351 15 555-9999" },
        tx,
      ),
    );
    if (!other.ok) {
      throw new Error("registerPatient failed");
    }
    const theirs = await add(receptionist, { patientId: other.patient.id });

    expect(await contact(theirs.id)).toEqual({ ok: false, reason: "notFound" });
  });

  it("keeps at most one contact per patient in the database", async () => {
    await add(receptionist);
    const second = await add(receptionist, { name: "Pedro Pérez" });
    await contact(second.id);

    // Past the services, as the app role.
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          admin,
          (tenant) =>
            tenant.insert(guardian).values({
              organizationId: admin.organizationId,
              patientId,
              name: "Otra",
              relationship: "Tía",
              phone: "+543514123456",
              messageContact: true,
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("falls back to the patient when the guardian who is the contact is removed", async () => {
    const mother = await add(receptionist);
    await add(receptionist, { name: "Pedro Pérez" });
    await contact(mother.id);

    await asAppRole(db, (tx) => removeGuardian(receptionist, { guardianId: mother.id }, tx));

    expect(await contactName()).toBeNull();
    expect((await history("patient")).at(-1)).toEqual({
      action: "update",
      userId: "receptionist",
      before: { messageContact: "Laura Gómez" },
      after: { messageContact: null },
    });
  });

  it("writes nothing when the contact asked for is the one already set", async () => {
    const mother = await add(receptionist);
    await contact(mother.id);
    await contact(mother.id);
    await contact(null);
    await contact(null);

    expect(
      (await history("patient")).filter((entry) => "messageContact" in (entry.after ?? {})),
    ).toHaveLength(2);
  });
});

describe("the audit log", () => {
  it("writes each guardian change to the patient's history", async () => {
    const mother = await add(receptionist, { documentType: "dni", documentNumber: "28123456" });
    await asAppRole(db, (tx) =>
      updateGuardian(
        practitioner,
        {
          guardianId: mother.id,
          name: "Laura Gómez",
          relationship: "Tutora",
          phone: "351 4123456",
          documentType: "dni",
          documentNumber: "28123456",
        },
        tx,
      ),
    );
    await asAppRole(db, (tx) => removeGuardian(admin, { guardianId: mother.id }, tx));

    expect(await history("guardian")).toEqual([
      {
        action: "create",
        userId: "receptionist",
        before: null,
        after: {
          name: "Laura Gómez",
          relationship: "Madre",
          documentType: "dni",
          documentNumber: "28123456",
          phone: "+543514123456",
        },
      },
      {
        action: "update",
        userId: "practitioner",
        before: { relationship: "Madre" },
        after: { relationship: "Tutora" },
      },
      {
        action: "delete",
        userId: admin.userId,
        before: {
          name: "Laura Gómez",
          relationship: "Tutora",
          documentType: "dni",
          documentNumber: "28123456",
          phone: "+543514123456",
        },
        after: null,
      },
    ]);
  });

  it("writes each change of message contact on the patient, the guardian by name", async () => {
    const mother = await add(receptionist);
    const father = await add(receptionist, { name: "Pedro Pérez" });
    await contact(mother.id);
    await contact(father.id, practitioner);
    await contact(null, admin);

    expect(
      (await history("patient")).filter((entry) => "messageContact" in (entry.after ?? {})),
    ).toEqual([
      {
        action: "update",
        userId: "receptionist",
        before: { messageContact: null },
        after: { messageContact: "Laura Gómez" },
      },
      {
        action: "update",
        userId: "practitioner",
        before: { messageContact: "Laura Gómez" },
        after: { messageContact: "Pedro Pérez" },
      },
      {
        action: "update",
        userId: admin.userId,
        before: { messageContact: "Pedro Pérez" },
        after: { messageContact: null },
      },
    ]);
  });
});

describe("minors", () => {
  async function minorOn(instant: string, birthDate: string | null) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));
    const updated = await asAppRole(db, (tx) =>
      updatePatient(receptionist, { ...patientFields, patientId, birthDate }, tx),
    );
    const found = await asAppRole(db, (tx) => getPatient(receptionist, { patientId }, tx));
    if (!updated.ok || !found.ok) {
      throw new Error("updatePatient or getPatient failed");
    }
    expect(updated.patient.minor).toBe(found.patient.minor);
    return found.patient.minor;
  }

  it("is a minor until their 18th birthday in the organization's time zone", async () => {
    // 23:59 of the eve in Buenos Aires (UTC-3), then midnight of the birthday.
    expect(await minorOn("2026-10-28T02:59:00Z", "2008-10-28")).toBe(true);
    expect(await minorOn("2026-10-28T03:00:00Z", "2008-10-28")).toBe(false);
    expect(await minorOn("2026-10-28T03:00:00Z", "2015-06-01")).toBe(true);
  });

  it("comes of age on 1 March when born on 29 February", async () => {
    expect(await minorOn("2026-03-01T02:59:00Z", "2008-02-29")).toBe(true);
    expect(await minorOn("2026-03-01T03:00:00Z", "2008-02-29")).toBe(false);
  });

  it("is not a minor with no birth date, but incomplete", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const found = await asAppRole(db, (tx) => getPatient(receptionist, { patientId }, tx));

    expect(found).toMatchObject({ ok: true, patient: { minor: false, incomplete: true } });
  });
});
