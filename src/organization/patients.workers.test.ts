import { describe, expect, it } from "vite-plus/test";

import { patientName, patientPageSize } from "#/lib/patients.ts";
import type { DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";

import {
  addMember,
  adminCaller,
  auditEntriesFor,
  setUpOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

const juan = { firstName: "Juan", lastName: "Pérez", phone: "0351 15 555-1234" };

const complete = {
  ...juan,
  chosenName: "Juana",
  documentType: "dni" as const,
  documentNumber: "30.123.456",
  birthDate: "1990-04-12",
  email: "juana@example.com",
  address: "Av. Colón 100",
};

/** A fresh organization with a receptionist and a practitioner. */
async function registry() {
  const { organization } = await setUpOrganization();
  const receptionist = await addMember(organization, ["receptionist"]);
  const practitioner = await addMember(organization, ["practitioner"]);
  return { organization, receptionist, practitioner };
}

async function register(
  organization: OrganizationStub,
  caller: typeof adminCaller,
  input: PatientInput & DuplicateConfirmation = juan,
) {
  const result = await organization.registerPatient(caller, input);
  if (!result.ok) {
    throw new Error(`registerPatient refused: ${result.reason}`);
  }
  return result.patient;
}

function edit(
  organization: OrganizationStub,
  caller: typeof adminCaller,
  patientId: string,
  fields: Partial<typeof complete> & DuplicateConfirmation = {},
) {
  return organization.updatePatient(caller, { ...juan, ...fields, patientId });
}

async function historyOf(organization: OrganizationStub, patientId: string) {
  const result = await organization.getPatientHistory(adminCaller, { patientId });
  if (!result.ok) {
    throw new Error(`getPatientHistory refused: ${result.reason}`);
  }
  return result.entries;
}

async function listAll(organization: OrganizationStub) {
  const result = await organization.listPatients(adminCaller, { includeInactive: true });
  if (!result.ok) {
    throw new Error(`listPatients refused: ${result.reason}`);
  }
  return result.patients;
}

describe("registering a patient", () => {
  it("registers with a name and a phone, stored in E.164, incomplete and consenting to WhatsApp", async () => {
    const { organization, receptionist } = await registry();
    const before = Date.now();

    const patient = await register(organization, receptionist);

    expect(patient).toMatchObject({
      firstName: "Juan",
      lastName: "Pérez",
      phone: "+5493515551234",
      birthDate: null,
      documentType: null,
      incomplete: true,
      minor: false,
      whatsappConsent: true,
      whatsappConsentBy: receptionist.userId,
      active: true,
    });
    expect(patient.whatsappConsentAt).toBeGreaterThanOrEqual(before);
  });

  it("writes the registration to the audit log with the values set, by the member's name", async () => {
    const { organization, receptionist } = await registry();
    const patient = await register(organization, receptionist);

    expect(await historyOf(organization, patient.id)).toMatchObject([
      {
        action: "create",
        entityType: "patient",
        userId: receptionist.userId,
        userName: "Miembro receptionist",
        before: null,
        after: { firstName: "Juan", lastName: "Pérez", phone: "+5493515551234" },
        timeZones: null,
      },
    ]);
  });
});

describe("registering in full", () => {
  it("takes the document, birth date, email, address and chosen name, and is complete", async () => {
    const { organization, receptionist } = await registry();

    expect(await register(organization, receptionist, complete)).toMatchObject({
      chosenName: "Juana",
      documentType: "dni",
      documentNumber: "30123456",
      birthDate: "1990-04-12",
      email: "juana@example.com",
      address: "Av. Colón 100",
      incomplete: false,
      minor: false,
    });
  });

  it("refuses a document another patient has, however the DNI is typed", async () => {
    const { organization, receptionist } = await registry();
    await register(organization, receptionist, complete);

    const result = await organization.registerPatient(receptionist, {
      firstName: "Otro",
      lastName: "Paciente",
      phone: "11 5555 1234",
      documentType: "dni",
      documentNumber: "30123456",
    });

    expect(result).toMatchObject({ ok: false, reason: "documentTaken" });
    expect((await listAll(organization)).map((row) => row.firstName)).toEqual(["Juan"]);
  });

  it("refuses a passport another patient has, whatever its case and separators", async () => {
    const { organization, receptionist } = await registry();
    await register(organization, receptionist, {
      ...complete,
      documentType: "passport",
      documentNumber: "aa 123.456",
    });

    const result = await organization.registerPatient(receptionist, {
      firstName: "Otro",
      lastName: "Paciente",
      phone: "11 5555 1234",
      documentType: "passport",
      documentNumber: "AA123456",
    });

    expect(result).toMatchObject({ ok: false, reason: "documentTaken" });
  });

  it("accepts the same number as another type of document, and patients with no document", async () => {
    const { organization, receptionist } = await registry();
    await register(organization, receptionist, complete);

    const sibling = { ...juan, confirmDuplicates: true };
    await register(organization, receptionist, {
      ...sibling,
      documentType: "passport",
      documentNumber: "30123456",
    });
    await register(organization, receptionist, sibling);
    await register(organization, receptionist, sibling);

    expect(await listAll(organization)).toHaveLength(4);
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
    const { organization, receptionist } = await registry();

    expect(await organization.registerPatient(receptionist, input)).toEqual({
      ok: false,
      reason: "invalidInput",
    });
  });
});

describe("editing a patient", () => {
  it("completes a patient, auditing only the fields that changed", async () => {
    const { organization, receptionist, practitioner } = await registry();
    const patient = await register(organization, receptionist);

    const result = await edit(organization, practitioner, patient.id, {
      birthDate: "2015-06-01",
      email: "",
    });

    expect(result).toMatchObject({
      ok: true,
      patient: { birthDate: "2015-06-01", incomplete: false, minor: true },
    });
    const [latest] = await historyOf(organization, patient.id);
    expect(latest).toMatchObject({
      action: "update",
      userId: practitioner.userId,
      before: { birthDate: null },
      after: { birthDate: "2015-06-01" },
    });
    expect(Object.keys(latest!.after!)).toEqual(["birthDate"]);
  });

  it("writes no audit entry for an edit that changes nothing", async () => {
    const { organization, receptionist } = await registry();
    const patient = await register(organization, receptionist);

    await edit(organization, receptionist, patient.id, { phone: "+54 9 351 555 1234" });

    expect(await historyOf(organization, patient.id)).toHaveLength(1);
  });

  it("refuses to give a patient a document another patient has", async () => {
    const { organization, receptionist } = await registry();
    const holder = await register(organization, receptionist, complete);
    const other = await register(organization, receptionist, {
      ...juan,
      phone: "011 15 4444-9876",
    });

    const result = await edit(organization, receptionist, other.id, {
      phone: "011 15 4444-9876",
      documentType: "dni",
      documentNumber: "30123456",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "documentTaken",
      patient: { id: holder.id },
    });
    expect(await historyOf(organization, other.id)).toHaveLength(1);
  });

  it("answers notFound for a patient that is not there", async () => {
    const { organization, receptionist } = await registry();
    const missing = "00000000-0000-4000-8000-000000000001";

    expect(await edit(organization, receptionist, missing)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await organization.getPatient(receptionist, { patientId: missing })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await organization.getPatientHistory(adminCaller, { patientId: "nope" })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("WhatsApp consent", () => {
  it("is turned off by any editor, audited, and back on records who gave it", async () => {
    const { organization, receptionist, practitioner } = await registry();
    const patient = await register(organization, adminCaller);

    const off = await organization.setWhatsappConsent(practitioner, {
      patientId: patient.id,
      whatsappConsent: false,
    });
    const on = await organization.setWhatsappConsent(receptionist, {
      patientId: patient.id,
      whatsappConsent: true,
    });

    expect(off).toMatchObject({
      ok: true,
      patient: { whatsappConsent: false, whatsappConsentBy: adminCaller.userId },
    });
    expect(on).toMatchObject({
      ok: true,
      patient: { whatsappConsent: true, whatsappConsentBy: receptionist.userId },
    });
    const [turnedOn, turnedOff] = await historyOf(organization, patient.id);
    expect(turnedOff).toMatchObject({
      action: "update",
      userId: practitioner.userId,
      before: { whatsappConsent: true },
      after: { whatsappConsent: false },
    });
    expect(turnedOn).toMatchObject({
      userId: receptionist.userId,
      after: { whatsappConsent: true },
    });
  });
});

describe("the patient list", () => {
  async function fullPage(organization: OrganizationStub, caller: typeof adminCaller) {
    for (let index = 0; index <= patientPageSize; index += 1) {
      await register(organization, caller, {
        firstName: "Ana",
        lastName: `Apellido ${String(index).padStart(2, "0")}`,
        phone: `0351 15 555-${1000 + index}`,
      });
    }
  }

  it("shows a page at a time, by last name, and says how many there are", async () => {
    const { organization, receptionist } = await registry();
    await fullPage(organization, receptionist);

    const first = await organization.listPatients(receptionist, { includeInactive: false });
    const second = await organization.listPatients(receptionist, {
      includeInactive: false,
      page: 2,
    });

    expect(first).toMatchObject({ ok: true, total: patientPageSize + 1, page: 1 });
    expect(first.ok && first.patients).toHaveLength(patientPageSize);
    expect(second).toMatchObject({ ok: true, page: 2 });
    expect(second.ok && second.patients.map((row) => row.lastName)).toEqual([
      `Apellido ${patientPageSize}`,
    ]);
  });

  it("answers with the last page when asked for one past it", async () => {
    const { organization, receptionist } = await registry();
    await fullPage(organization, receptionist);

    const past = await organization.listPatients(receptionist, { includeInactive: false, page: 9 });

    expect(past).toMatchObject({ ok: true, page: 2 });
    expect(past.ok && past.patients).toHaveLength(1);
  });

  it("answers an empty registry on page one, and refuses a page that is not a positive whole number", async () => {
    const { organization, receptionist } = await registry();
    const list = (page: number) =>
      organization.listPatients(receptionist, { includeInactive: false, page });

    expect(await list(9)).toMatchObject({ ok: true, patients: [], total: 0, page: 1 });
    expect(await list(0)).toEqual({ ok: false, reason: "invalidInput" });
    expect(await list(1.5)).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("names a patient's primary insurer, in the list and in a search, and none for a private one", async () => {
    const { organization, receptionist } = await registry();
    const covered = await register(organization, receptionist);
    await register(organization, receptionist, {
      firstName: "Luz",
      lastName: "Pérez",
      phone: "0351 15 555-4321",
    });
    const created = await organization.createInsurer(adminCaller, {
      name: "OSDE",
      kind: "prepaga",
    });
    if (!created.ok) {
      throw new Error(`createInsurer refused: ${created.reason}`);
    }
    await organization.addCoverage(receptionist, {
      patientId: covered.id,
      insurerId: created.insurer.id,
      memberNumber: "123",
      primary: true,
    });

    const listed = await organization.listPatients(receptionist, { includeInactive: false });
    const found = await organization.searchPatients(receptionist, {
      query: "perez",
      includeInactive: false,
    });

    for (const result of [listed, found]) {
      expect(
        result.ok && result.patients.map((row) => [row.firstName, row.insurerName]).sort(),
      ).toEqual([
        ["Juan", "OSDE"],
        ["Luz", null],
      ]);
    }
  });
});

describe("deactivating a patient", () => {
  it("drops a deactivated patient from the default list, keeps their data, and reactivates them, audited", async () => {
    const { organization, receptionist } = await registry();
    const patient = await register(organization, receptionist);

    await organization.setPatientActive(adminCaller, { id: patient.id, active: false });
    const active = await organization.listPatients(receptionist, { includeInactive: false });
    const all = await organization.listPatients(receptionist, { includeInactive: true });
    const found = await organization.getPatient(receptionist, { patientId: patient.id });
    await organization.setPatientActive(adminCaller, { id: patient.id, active: true });

    expect(active).toMatchObject({ ok: true, patients: [], total: 0 });
    expect(all).toMatchObject({ ok: true, patients: [{ id: patient.id, active: false }] });
    expect(found).toMatchObject({ ok: true, patient: { firstName: "Juan", active: false } });
    expect(await auditEntriesFor(organization, patient.id)).toMatchObject([
      { action: "create" },
      { action: "deactivate", before: { active: true }, after: { active: false } },
      { action: "reactivate", before: { active: false }, after: { active: true } },
    ]);
  });

  it("writes no entry when the patient is already in the state asked for", async () => {
    const { organization, receptionist } = await registry();
    const patient = await register(organization, receptionist);

    expect(
      await organization.setPatientActive(adminCaller, { id: patient.id, active: true }),
    ).toEqual({ ok: true });
    expect(await historyOf(organization, patient.id)).toHaveLength(1);
  });

  it("answers notFound for a patient that is not there", async () => {
    const { organization } = await registry();

    expect(
      await organization.setPatientActive(adminCaller, {
        id: "00000000-0000-4000-8000-000000000001",
        active: false,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("permissions", () => {
  it("lets a practitioner register and edit a patient", async () => {
    const { organization, practitioner } = await registry();
    const patient = await register(organization, practitioner);

    expect(await edit(organization, practitioner, patient.id, { lastName: "Gómez" })).toMatchObject(
      { ok: true },
    );
  });

  it("refuses deactivation and the change history to everyone but an admin", async () => {
    const { organization, receptionist, practitioner } = await registry();
    const patient = await register(organization, receptionist);

    for (const caller of [receptionist, practitioner]) {
      expect(
        await organization.setPatientActive(caller, { id: patient.id, active: false }),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(await organization.getPatientHistory(caller, { patientId: patient.id })).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
    expect((await historyOf(organization, patient.id)).map((entry) => entry.action)).toEqual([
      "create",
    ]);
  });

  it("refuses a caller who is not a member", async () => {
    const { organization } = await registry();
    const stranger = { userId: "user-stranger" };

    expect(await organization.registerPatient(stranger, juan)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(
      await organization.searchPatients(stranger, { query: "juan", includeInactive: false }),
    ).toEqual({ ok: false, reason: "unauthenticated" });
  });
});

describe("the duplicate check", () => {
  const sibling = { firstName: "Lucía", lastName: "Pérez", phone: juan.phone };

  it("names the patient who already has the document", async () => {
    const { organization, receptionist } = await registry();
    const holder = await register(organization, receptionist, complete);

    const result = await organization.registerPatient(receptionist, {
      ...sibling,
      documentType: "dni",
      documentNumber: "30123456",
      confirmDuplicates: true,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "documentTaken",
      patient: { id: holder.id, firstName: "Juan" },
    });
  });

  it("warns about a patient with the same phone, and registers a sibling once confirmed", async () => {
    const { organization, receptionist } = await registry();
    const first = await register(organization, receptionist);

    const warned = await organization.registerPatient(receptionist, sibling);
    const confirmed = await organization.registerPatient(receptionist, {
      ...sibling,
      confirmDuplicates: true,
    });

    expect(warned).toEqual({
      ok: false,
      reason: "possibleDuplicates",
      candidates: [{ patient: expect.objectContaining({ id: first.id }), matches: ["phone"] }],
    });
    expect(confirmed).toMatchObject({ ok: true, patient: { firstName: "Lucía" } });
    expect(await listAll(organization)).toHaveLength(2);
  });

  it("warns about the same name, however it is written, and the same birth date", async () => {
    const { organization, receptionist } = await registry();
    const first = await register(organization, receptionist, { ...juan, birthDate: "1990-04-12" });

    const sameName = await organization.registerPatient(receptionist, {
      firstName: " juan ",
      lastName: "PEREZ",
      phone: "011 15 4444-9876",
      birthDate: "1990-04-12",
    });
    const otherBirthDate = await organization.registerPatient(receptionist, {
      firstName: "Juan",
      lastName: "Pérez",
      phone: "011 15 4444-9876",
      birthDate: "1991-04-12",
    });

    expect(sameName).toMatchObject({
      ok: false,
      reason: "possibleDuplicates",
      candidates: [{ patient: { id: first.id }, matches: ["nameAndBirthDate"] }],
    });
    expect(otherBirthDate).toMatchObject({ ok: true });
  });

  it("re-checks an edit that changes the phone, and not one that leaves it", async () => {
    const { organization, receptionist } = await registry();
    const first = await register(organization, receptionist);
    const other = await register(organization, receptionist, {
      firstName: "Ana",
      lastName: "Sosa",
      phone: "011 15 4444-9876",
    });
    const ana = { firstName: "Ana", lastName: "Sosa", phone: juan.phone };

    const changedPhone = await edit(organization, receptionist, other.id, ana);
    const confirmed = await edit(organization, receptionist, other.id, {
      ...ana,
      confirmDuplicates: true,
    });
    const sameFields = await edit(organization, receptionist, other.id, {
      ...ana,
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
    const { organization, receptionist } = await registry();
    const patient = await register(organization, receptionist, {
      ...juan,
      birthDate: "1990-04-12",
    });

    expect(
      await edit(organization, receptionist, patient.id, {
        birthDate: "1990-04-12",
        lastName: "Perez",
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("searching patients", () => {
  /** A registry with the search's patients, and a search as the receptionist. */
  async function searchable() {
    const { organization, receptionist } = await registry();
    await register(organization, receptionist, {
      ...juan,
      documentType: "dni",
      documentNumber: "30123456",
    });
    await register(organization, receptionist, {
      firstName: "María José",
      lastName: "Núñez",
      chosenName: "Majo",
      phone: "011 15 4444-9876",
    });
    await register(organization, receptionist, {
      firstName: "Pedro",
      lastName: "Gómez Pereyra",
      phone: "0261 15 666-7788",
      documentType: "passport",
      documentNumber: "AB123",
    });
    const search = async (query: string, includeInactive = false) => {
      const result = await organization.searchPatients(receptionist, { query, includeInactive });
      if (!result.ok) {
        throw new Error(`searchPatients refused: ${result.reason}`);
      }
      return result.patients.map(patientName);
    };
    return { organization, receptionist, search };
  }

  it("finds a name ignoring accents, case and word order", async () => {
    const { search } = await searchable();

    expect(await search("nunez")).toEqual(["Majo Núñez"]);
    expect(await search("perez juan")).toEqual(["Juan Pérez"]);
    expect(await search("NUÑEZ")).toEqual(["Majo Núñez"]);
    expect(await search("jose nunez maria")).toEqual(["Majo Núñez"]);
  });

  it("finds a name with a letter wrong", async () => {
    const { organization, receptionist, search } = await searchable();
    await register(organization, receptionist, {
      firstName: "Rosa",
      lastName: "González",
      phone: "0351 15 777-1111",
    });

    expect(await search("gonzales")).toEqual(["Rosa González"]);
    expect(await search("gomes pedro")).toEqual(["Pedro Gómez Pereyra"]);
  });

  it("finds a patient by their chosen name", async () => {
    const { search } = await searchable();

    expect(await search("majo")).toEqual(["Majo Núñez"]);
  });

  it("finds a patient by their document number, or digits of their document or their phone", async () => {
    const { search } = await searchable();

    expect(await search("30123456")).toEqual(["Juan Pérez"]);
    expect(await search("30.123.456")).toEqual(["Juan Pérez"]);
    expect(await search("4444 9876")).toEqual(["Majo Núñez"]);
    expect(await search("0261 15 666-7788")).toEqual(["Pedro Gómez Pereyra"]);
  });

  it("puts the best match first", async () => {
    const { organization, receptionist, search } = await searchable();
    await register(organization, receptionist, {
      firstName: "Juan",
      lastName: "Pereyra",
      phone: "0351 15 777-0000",
    });

    expect(await search("juan pere")).toEqual(["Juan Pérez", "Juan Pereyra"]);
    expect(await search("pereyra")).toEqual(["Juan Pereyra", "Pedro Gómez Pereyra"]);
  });

  it("leaves deactivated patients out unless asked for", async () => {
    const { organization, search } = await searchable();
    const majo = (await listAll(organization)).find((row) => row.chosenName === "Majo");
    await organization.setPatientActive(adminCaller, { id: majo!.id, active: false });

    expect(await search("majo")).toEqual([]);
    expect(await search("majo", true)).toEqual(["Majo Núñez"]);
  });

  it("stops at 20 matches, and says when there are more", async () => {
    const { organization, receptionist } = await searchable();
    const searchSosa = async () => {
      const result = await organization.searchPatients(receptionist, {
        query: "sosa",
        includeInactive: false,
      });
      return result.ok && { shown: result.patients.length, more: result.more };
    };
    for (let index = 0; index < 20; index += 1) {
      await register(organization, receptionist, {
        firstName: `Ana${index}`,
        lastName: "Sosa",
        phone: `0351 15 500-${String(1000 + index)}`,
      });
    }

    expect(await searchSosa()).toEqual({ shown: 20, more: false });

    await register(organization, receptionist, {
      firstName: "Ana20",
      lastName: "Sosa",
      phone: "0351 15 500-1020",
    });

    expect(await searchSosa()).toEqual({ shown: 20, more: true });
  });

  it("finds nothing, and no more, for a name no patient has or an empty query", async () => {
    const { organization, receptionist } = await searchable();

    for (const query of ["rodríguez", "  "]) {
      expect(
        await organization.searchPatients(receptionist, { query, includeInactive: false }),
      ).toEqual({ ok: true, patients: [], more: false });
    }
  });
});
