import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import { patientName } from "#/lib/patients.ts";
import { createOrganization } from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  getPatient,
  getPatientHistory,
  listPatients,
  registerPatient,
  searchPatients,
  setPatientActive,
  setWhatsappConsent,
  updatePatient,
} from "#/server/patients.ts";

// Every call runs as the app role, so row-level security applies as in the app.

let client: PGlite;
let db: TestDatabase;
let admin: Actor;
let receptionist: Actor;
let practitioner: Actor;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  const { organizationId, adminUserId } = await createOrganization(createAuth(db));
  admin = { organizationId, userId: adminUserId, roles: ["admin"] };
  receptionist = { organizationId, userId: "receptionist", roles: ["receptionist"] };
  practitioner = { organizationId, userId: "practitioner", roles: ["practitioner"] };
});

afterEach(async () => {
  await client.close();
});

const juan = { firstName: "Juan", lastName: "Pérez", phone: "0351 15 555-1234" };

async function register(actor: Actor, input: Parameters<typeof registerPatient>[1] = juan) {
  const result = await asAppRole(db, (tx) => registerPatient(actor, input, tx));
  if (!result.ok) {
    throw new Error(`registerPatient failed: ${result.reason}`);
  }
  return result.patient;
}

async function historyOf(patientId: string) {
  const result = await asAppRole(db, (tx) => getPatientHistory(admin, { patientId }, tx));
  if (!result.ok) {
    throw new Error(`getPatientHistory failed: ${result.reason}`);
  }
  return result.entries;
}

describe("registering a patient", () => {
  it("registers with a name and a phone, stored in E.164, incomplete and consenting to WhatsApp", async () => {
    const before = new Date();
    const patient = await register(receptionist);

    expect(patient).toMatchObject({
      firstName: "Juan",
      lastName: "Pérez",
      phone: "+5493515551234",
      birthDate: null,
      documentType: null,
      incomplete: true,
      whatsappConsent: true,
      whatsappConsentBy: "receptionist",
      active: true,
    });
    expect(patient.whatsappConsentAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("writes the registration to the audit log with the values set", async () => {
    const patient = await register(receptionist);

    expect(await historyOf(patient.id)).toMatchObject([
      {
        action: "create",
        entityType: "patient",
        userId: "receptionist",
        before: null,
        after: { firstName: "Juan", lastName: "Pérez", phone: "+5493515551234" },
      },
    ]);
  });
});

const complete = {
  ...juan,
  chosenName: "Juana",
  documentType: "dni" as const,
  documentNumber: "30.123.456",
  birthDate: "1990-04-12",
  email: "juana@example.com",
  address: "Av. Colón 100",
};

async function edit(actor: Actor, patientId: string, fields: Partial<typeof complete> = {}) {
  return asAppRole(db, (tx) => updatePatient(actor, { ...juan, ...fields, patientId }, tx));
}

describe("registering in full", () => {
  it("takes the document, birth date, email, address and chosen name, and is complete", async () => {
    const patient = await register(receptionist, complete);

    expect(patient).toMatchObject({
      chosenName: "Juana",
      documentType: "dni",
      documentNumber: "30123456",
      birthDate: "1990-04-12",
      email: "juana@example.com",
      address: "Av. Colón 100",
      incomplete: false,
    });
  });

  it("refuses a document another patient of the organization has, however the DNI is typed", async () => {
    await register(receptionist, complete);

    const result = await asAppRole(db, (tx) =>
      registerPatient(
        receptionist,
        {
          firstName: "Otro",
          lastName: "Paciente",
          phone: "11 5555 1234",
          documentType: "dni",
          documentNumber: "30123456",
        },
        tx,
      ),
    );

    expect(result).toMatchObject({ ok: false, reason: "documentTaken" });
    const listed = await asAppRole(db, (tx) => listPatients(admin, { includeInactive: true }, tx));
    expect(listed.ok && listed.patients.map((row) => row.firstName)).toEqual(["Juan"]);
  });

  it("accepts the same number as another type of document, and patients with no document", async () => {
    await register(receptionist, complete);

    const sibling = { ...juan, confirmDuplicates: true };
    await register(receptionist, {
      ...sibling,
      documentType: "passport",
      documentNumber: "30123456",
    });
    await register(receptionist, sibling);
    await register(receptionist, sibling);

    const listed = await asAppRole(db, (tx) => listPatients(admin, { includeInactive: true }, tx));
    expect(listed.ok && listed.patients).toHaveLength(4);
  });

  it.each([
    ["a phone with no area code", { ...juan, phone: "555-1234" }],
    ["an invalid phone", { ...juan, phone: "12" }],
    ["a document number with no type", { ...juan, documentNumber: "123" }],
    [
      "a DNI that is not a number",
      { ...juan, documentType: "dni" as const, documentNumber: "ABC" },
    ],
  ])("refuses %s as invalid input", async (_, input) => {
    expect(await asAppRole(db, (tx) => registerPatient(receptionist, input, tx))).toEqual({
      ok: false,
      reason: "invalidInput",
    });
  });
});

describe("editing a patient", () => {
  it("completes a patient, auditing only the fields that changed", async () => {
    const patient = await register(receptionist);

    const result = await edit(practitioner, patient.id, { birthDate: "2015-06-01", email: "" });

    expect(result).toMatchObject({
      ok: true,
      patient: { birthDate: "2015-06-01", incomplete: false },
    });
    const [latest] = await historyOf(patient.id);
    expect(latest).toMatchObject({
      action: "update",
      userId: "practitioner",
      before: { birthDate: null },
      after: { birthDate: "2015-06-01" },
    });
    expect(Object.keys(latest!.after!)).toEqual(["birthDate"]);
  });

  it("writes no audit entry for an edit that changes nothing", async () => {
    const patient = await register(receptionist);

    await edit(receptionist, patient.id, { phone: "+54 9 351 555 1234" });

    expect(await historyOf(patient.id)).toHaveLength(1);
  });

  it("refuses to give a patient a document another patient has", async () => {
    const holder = await register(receptionist, complete);
    const other = await register(receptionist, { ...juan, phone: "011 15 4444-9876" });

    const result = await edit(receptionist, other.id, {
      phone: "011 15 4444-9876",
      documentType: "dni",
      documentNumber: "30123456",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "documentTaken",
      patient: { id: holder.id },
    });
    expect(await historyOf(other.id)).toHaveLength(1);
  });

  it("answers not found for a patient that is not there", async () => {
    expect(await edit(receptionist, "00000000-0000-4000-8000-000000000001")).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("WhatsApp consent", () => {
  it("is turned off by any editor, audited, and back on records who gave it", async () => {
    const patient = await register(admin);

    const off = await asAppRole(db, (tx) =>
      setWhatsappConsent(practitioner, { patientId: patient.id, whatsappConsent: false }, tx),
    );
    const on = await asAppRole(db, (tx) =>
      setWhatsappConsent(receptionist, { patientId: patient.id, whatsappConsent: true }, tx),
    );

    expect(off).toMatchObject({
      ok: true,
      patient: { whatsappConsent: false, whatsappConsentBy: admin.userId },
    });
    expect(on).toMatchObject({
      ok: true,
      patient: { whatsappConsent: true, whatsappConsentBy: "receptionist" },
    });
    const [turnedOn, turnedOff] = await historyOf(patient.id);
    expect(turnedOff).toMatchObject({
      action: "update",
      userId: "practitioner",
      before: { whatsappConsent: true },
      after: { whatsappConsent: false },
    });
    expect(turnedOn).toMatchObject({ userId: "receptionist", after: { whatsappConsent: true } });
  });
});

describe("deactivating a patient", () => {
  it("drops a deactivated patient from the default list, keeps their data, and reactivates them, audited", async () => {
    const patient = await register(receptionist);

    await asAppRole(db, (tx) => setPatientActive(admin, { id: patient.id, active: false }, tx));
    const active = await asAppRole(db, (tx) =>
      listPatients(receptionist, { includeInactive: false }, tx),
    );
    const all = await asAppRole(db, (tx) =>
      listPatients(receptionist, { includeInactive: true }, tx),
    );
    const found = await asAppRole(db, (tx) =>
      getPatient(receptionist, { patientId: patient.id }, tx),
    );
    await asAppRole(db, (tx) => setPatientActive(admin, { id: patient.id, active: true }, tx));

    expect(active).toEqual({ ok: true, patients: [] });
    expect(all).toMatchObject({ ok: true, patients: [{ id: patient.id, active: false }] });
    expect(found).toMatchObject({ ok: true, patient: { firstName: "Juan", active: false } });
    expect((await historyOf(patient.id)).map((entry) => entry.action)).toEqual([
      "reactivate",
      "deactivate",
      "create",
    ]);
  });

  it("writes no entry when the patient is already in the state asked for", async () => {
    const patient = await register(receptionist);

    const result = await asAppRole(db, (tx) =>
      setPatientActive(admin, { id: patient.id, active: true }, tx),
    );

    expect(result).toEqual({ ok: true });
    expect(await historyOf(patient.id)).toHaveLength(1);
  });
});

describe("permissions", () => {
  it("lets a practitioner register and edit a patient", async () => {
    const patient = await register(practitioner);

    expect(await edit(practitioner, patient.id, { lastName: "Gómez" })).toMatchObject({ ok: true });
  });

  it("refuses deactivation and the change history to everyone but an admin", async () => {
    const patient = await register(receptionist);

    for (const actor of [receptionist, practitioner]) {
      expect(
        await asAppRole(db, (tx) => setPatientActive(actor, { id: patient.id, active: false }, tx)),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(
        await asAppRole(db, (tx) => getPatientHistory(actor, { patientId: patient.id }, tx)),
      ).toEqual({ ok: false, reason: "forbidden" });
    }
    expect((await historyOf(patient.id)).map((entry) => entry.action)).toEqual(["create"]);
  });

  it("refuses a member with none of the staff roles", async () => {
    const nobody: Actor = { ...receptionist, roles: [] };

    expect(await asAppRole(db, (tx) => registerPatient(nobody, juan, tx))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await asAppRole(db, (tx) => listPatients(nobody, { includeInactive: false }, tx)),
    ).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

async function search(query: string, includeInactive = false) {
  const result = await asAppRole(db, (tx) =>
    searchPatients(receptionist, { query, includeInactive }, tx),
  );
  if (!result.ok) {
    throw new Error(`searchPatients failed: ${result.reason}`);
  }
  return result.patients.map(patientName);
}

describe("searching patients", () => {
  beforeEach(async () => {
    await register(receptionist, {
      ...juan,
      documentType: "dni",
      documentNumber: "30123456",
    });
    await register(receptionist, {
      firstName: "María José",
      lastName: "Núñez",
      chosenName: "Majo",
      phone: "011 15 4444-9876",
    });
    await register(receptionist, {
      firstName: "Pedro",
      lastName: "Gómez Pereyra",
      phone: "0261 15 666-7788",
      documentType: "passport",
      documentNumber: "AB123",
    });
  });

  it("finds a name ignoring accents, case and word order", async () => {
    expect(await search("perez juan")).toEqual(["Juan Pérez"]);
    expect(await search("NUÑEZ")).toEqual(["Majo Núñez"]);
    expect(await search("jose nunez maria")).toEqual(["Majo Núñez"]);
  });

  it("finds a name with a letter wrong", async () => {
    expect(await search("gomes pedro")).toEqual(["Pedro Gómez Pereyra"]);
  });

  it("finds a patient by their chosen name", async () => {
    expect(await search("majo")).toEqual(["Majo Núñez"]);
  });

  it("finds a patient by digits of their document or their phone", async () => {
    expect(await search("30123456")).toEqual(["Juan Pérez"]);
    expect(await search("30.123.456")).toEqual(["Juan Pérez"]);
    expect(await search("4444 9876")).toEqual(["Majo Núñez"]);
    expect(await search("0261 15 666-7788")).toEqual(["Pedro Gómez Pereyra"]);
  });

  it("puts the best match first", async () => {
    await register(receptionist, {
      firstName: "Juan",
      lastName: "Pereyra",
      phone: "0351 15 777-0000",
    });

    expect(await search("juan pere")).toEqual(["Juan Pérez", "Juan Pereyra"]);
    expect(await search("pereyra")).toEqual(["Juan Pereyra", "Pedro Gómez Pereyra"]);
  });

  it("finds nothing for a name no patient has, or an empty query", async () => {
    expect(await search("rodríguez")).toEqual([]);
    expect(await search("  ")).toEqual([]);
  });

  it("leaves deactivated patients out unless asked for", async () => {
    const all = await asAppRole(db, (tx) => listPatients(admin, { includeInactive: false }, tx));
    const majo = all.ok ? all.patients.find((row) => row.chosenName === "Majo") : undefined;
    await asAppRole(db, (tx) => setPatientActive(admin, { id: majo!.id, active: false }, tx));

    expect(await search("majo")).toEqual([]);
    expect(await search("majo", true)).toEqual(["Majo Núñez"]);
  });

  it("returns a limited number of results", async () => {
    for (let index = 0; index < 25; index += 1) {
      await register(receptionist, {
        firstName: `Ana${index}`,
        lastName: "Sosa",
        phone: `0351 15 500-${String(1000 + index)}`,
      });
    }

    expect(await search("sosa")).toHaveLength(20);
  });
});

describe("the duplicate check", () => {
  const sibling = { firstName: "Lucía", lastName: "Pérez", phone: juan.phone };

  it("names the patient who already has the document", async () => {
    const holder = await register(receptionist, complete);

    const result = await asAppRole(db, (tx) =>
      registerPatient(
        receptionist,
        { ...sibling, documentType: "dni", documentNumber: "30123456", confirmDuplicates: true },
        tx,
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "documentTaken",
      patient: { id: holder.id, firstName: "Juan" },
    });
  });

  it("warns about a patient with the same phone, and registers a sibling once confirmed", async () => {
    const first = await register(receptionist);

    const warned = await asAppRole(db, (tx) => registerPatient(receptionist, sibling, tx));
    const confirmed = await asAppRole(db, (tx) =>
      registerPatient(receptionist, { ...sibling, confirmDuplicates: true }, tx),
    );

    expect(warned).toEqual({
      ok: false,
      reason: "possibleDuplicates",
      candidates: [{ patient: expect.objectContaining({ id: first.id }), matches: ["phone"] }],
    });
    expect(confirmed).toMatchObject({ ok: true, patient: { firstName: "Lucía" } });
    const listed = await asAppRole(db, (tx) => listPatients(admin, { includeInactive: true }, tx));
    expect(listed.ok && listed.patients).toHaveLength(2);
  });

  it("warns about the same name, however it is written, and the same birth date", async () => {
    const first = await register(receptionist, { ...juan, birthDate: "1990-04-12" });

    const sameName = await asAppRole(db, (tx) =>
      registerPatient(
        receptionist,
        {
          firstName: " juan ",
          lastName: "PEREZ",
          phone: "011 15 4444-9876",
          birthDate: "1990-04-12",
        },
        tx,
      ),
    );
    const otherBirthDate = await asAppRole(db, (tx) =>
      registerPatient(
        receptionist,
        {
          firstName: "Juan",
          lastName: "Pérez",
          phone: "011 15 4444-9876",
          birthDate: "1991-04-12",
        },
        tx,
      ),
    );

    expect(sameName).toMatchObject({
      ok: false,
      reason: "possibleDuplicates",
      candidates: [{ patient: { id: first.id }, matches: ["nameAndBirthDate"] }],
    });
    expect(otherBirthDate).toMatchObject({ ok: true });
  });

  it("re-checks an edit that changes the phone, and not one that leaves it", async () => {
    const first = await register(receptionist);
    const other = await register(receptionist, {
      firstName: "Ana",
      lastName: "Sosa",
      phone: "011 15 4444-9876",
    });

    const changedPhone = await edit(receptionist, other.id, {
      firstName: "Ana",
      lastName: "Sosa",
      phone: juan.phone,
    });
    const confirmed = await asAppRole(db, (tx) =>
      updatePatient(
        receptionist,
        {
          firstName: "Ana",
          lastName: "Sosa",
          phone: juan.phone,
          patientId: other.id,
          confirmDuplicates: true,
        },
        tx,
      ),
    );
    const sameFields = await edit(receptionist, other.id, {
      firstName: "Ana",
      lastName: "Sosa",
      phone: juan.phone,
      email: "ana@example.com",
    });

    expect(changedPhone).toMatchObject({
      ok: false,
      reason: "possibleDuplicates",
      candidates: [{ patient: { id: first.id }, matches: ["phone"] }],
    });
    expect(confirmed).toMatchObject({ ok: true, patient: { phone: "+5493515551234" } });
    expect(sameFields).toMatchObject({ ok: true, patient: { email: "ana@example.com" } });
  });

  it("does not warn a patient about themselves", async () => {
    const patient = await register(receptionist, { ...juan, birthDate: "1990-04-12" });

    expect(
      await edit(receptionist, patient.id, { birthDate: "1990-04-12", lastName: "Perez" }),
    ).toMatchObject({
      ok: true,
    });
  });
});
