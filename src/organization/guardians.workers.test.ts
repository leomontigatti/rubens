import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { GuardianInput } from "#/lib/guardians.ts";

import {
  addMember,
  adminCaller,
  inStorage,
  setUpOrganization,
} from "#/organization/organization.test-support.ts";
import { guardian } from "#/organization/schema.ts";

const missing = "00000000-0000-4000-8000-000000000000";
const patientFields = { firstName: "Tomás", lastName: "Pérez", phone: "0351 15 555-1234" };
const laura = { name: "Laura Gómez", relationship: "Madre", phone: "351 4123456" };

afterEach(() => {
  vi.useRealTimers();
});

/** A registered patient, with a receptionist and a practitioner. */
async function patientWithGuardians() {
  const { organization } = await setUpOrganization();
  const receptionist = await addMember(organization, ["receptionist"]);
  const practitioner = await addMember(organization, ["practitioner"]);
  const registered = await organization.registerPatient(receptionist, patientFields);
  if (!registered.ok) {
    throw new Error(`registerPatient refused: ${registered.reason}`);
  }
  const patientId = registered.patient.id;

  const add = async (caller: typeof adminCaller, input: Partial<GuardianInput> = {}) => {
    const result = await organization.addGuardian(caller, { patientId, ...laura, ...input });
    if (!result.ok) {
      throw new Error(`addGuardian refused: ${result.reason}`);
    }
    return result.guardian;
  };
  const guardians = async () => {
    const result = await organization.listGuardians(receptionist, { patientId });
    if (!result.ok) {
      throw new Error(`listGuardians refused: ${result.reason}`);
    }
    return result.guardians;
  };
  const contact = (guardianId: string | null, caller: typeof adminCaller = receptionist) =>
    organization.setMessageContact(caller, { patientId, guardianId });
  const contactName = async () =>
    (await guardians()).find((row) => row.messageContact)?.name ?? null;
  /** The patient's entries about `entityType`, oldest first. */
  const history = async (entityType: string) => {
    const result = await organization.getPatientHistory(adminCaller, { patientId });
    if (!result.ok) {
      throw new Error(`getPatientHistory refused: ${result.reason}`);
    }
    return result.entries
      .filter((entry) => entry.entityType === entityType)
      .map(({ action, userId, before, after }) => ({ action, userId, before, after }))
      .reverse();
  };
  return {
    organization,
    receptionist,
    practitioner,
    patientId,
    add,
    guardians,
    contact,
    contactName,
    history,
  };
}

describe("a patient's guardians", () => {
  it("lets receptionists, admins and practitioners add guardians, the phone read as a patient's", async () => {
    const { receptionist, practitioner, patientId, add, guardians } = await patientWithGuardians();

    const mother = await add(receptionist, {
      documentType: "dni",
      documentNumber: "28.123.456",
      email: "laura@example.com",
    });
    await add(adminCaller, {
      name: "Pedro Pérez",
      relationship: "Padre",
      phone: "+34 612 345 678",
    });
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
    const { organization, receptionist, patientId } = await patientWithGuardians();

    for (const phone of ["123", "4123456"]) {
      expect(await organization.addGuardian(receptionist, { ...laura, patientId, phone })).toEqual({
        ok: false,
        reason: "invalidInput",
      });
    }
  });

  it("edits a guardian's fields", async () => {
    const { organization, receptionist, practitioner, add } = await patientWithGuardians();
    const added = await add(receptionist, { email: "laura@example.com" });

    const result = await organization.updateGuardian(practitioner, {
      guardianId: added.id,
      name: "Laura Gómez",
      relationship: "Tutora",
      phone: "0351 15 444-1111",
      email: "",
    });

    expect(result).toMatchObject({
      ok: true,
      guardian: { relationship: "Tutora", phone: "+5493514441111", email: null },
    });
  });

  it("removes a guardian", async () => {
    const { organization, receptionist, add, guardians } = await patientWithGuardians();
    const added = await add(receptionist);
    const other = await add(receptionist, { name: "Pedro Pérez" });

    expect(await organization.removeGuardian(receptionist, { guardianId: added.id })).toEqual({
      ok: true,
    });
    expect((await guardians()).map((row) => row.id)).toEqual([other.id]);
  });

  it("refuses guardian calls to a caller who is not a member", async () => {
    const { organization, receptionist, patientId, add, contact } = await patientWithGuardians();
    const added = await add(receptionist);
    const stranger = { userId: "user-stranger" };

    for (const result of [
      await organization.listGuardians(stranger, { patientId }),
      await organization.addGuardian(stranger, { ...laura, patientId }),
      await organization.updateGuardian(stranger, { ...laura, guardianId: added.id }),
      await organization.removeGuardian(stranger, { guardianId: added.id }),
      await contact(added.id, stranger),
    ]) {
      expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    }
  });

  it("answers notFound for a patient or a guardian that is not there", async () => {
    const { organization, receptionist, contact } = await patientWithGuardians();

    for (const result of [
      await organization.listGuardians(receptionist, { patientId: missing }),
      await organization.addGuardian(receptionist, { ...laura, patientId: missing }),
      await organization.updateGuardian(receptionist, { ...laura, guardianId: missing }),
      await organization.removeGuardian(receptionist, { guardianId: missing }),
      await organization.setMessageContact(receptionist, { patientId: missing, guardianId: null }),
      await contact(missing),
    ]) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
  });
});

describe("the message contact", () => {
  it("is the patient until a guardian is chosen, and is one guardian at most", async () => {
    const { receptionist, practitioner, add, guardians, contact, contactName } =
      await patientWithGuardians();
    const mother = await add(receptionist);
    const father = await add(receptionist, { name: "Pedro Pérez", relationship: "Padre" });
    expect(await contactName()).toBeNull();

    expect(await contact(mother.id)).toEqual({ ok: true });
    expect(await contactName()).toBe("Laura Gómez");

    expect(await contact(father.id, practitioner)).toEqual({ ok: true });
    expect((await guardians()).filter((row) => row.messageContact).map((row) => row.id)).toEqual([
      father.id,
    ]);

    expect(await contact(null, adminCaller)).toEqual({ ok: true });
    expect(await contactName()).toBeNull();
  });

  it("refuses another patient's guardian", async () => {
    const { organization, receptionist, add, contact } = await patientWithGuardians();
    const other = await organization.registerPatient(receptionist, {
      firstName: "Lucía",
      lastName: "Paz",
      phone: "0351 15 555-9999",
    });
    if (!other.ok) {
      throw new Error("registerPatient refused");
    }
    const theirs = await add(receptionist, { patientId: other.patient.id });

    expect(await contact(theirs.id)).toEqual({ ok: false, reason: "notFound" });
  });

  it("keeps at most one contact per patient in storage", async () => {
    const { organization, receptionist, patientId, add, contact } = await patientWithGuardians();
    await add(receptionist);
    const second = await add(receptionist, { name: "Pedro Pérez" });
    await contact(second.id);

    // Past the object's methods, on its storage.
    await expect(
      inStorage(organization, (database) =>
        database
          .insert(guardian)
          .values({
            patientId,
            name: "Otra",
            relationship: "Tía",
            phone: "+543514123456",
            messageContact: true,
          })
          .run(),
      ),
    ).rejects.toThrow();
  });

  it("falls back to the patient when the guardian who is the contact is removed", async () => {
    const { organization, receptionist, add, contact, contactName, history } =
      await patientWithGuardians();
    const mother = await add(receptionist);
    await add(receptionist, { name: "Pedro Pérez" });
    await contact(mother.id);

    await organization.removeGuardian(receptionist, { guardianId: mother.id });

    expect(await contactName()).toBeNull();
    expect((await history("patient")).at(-1)).toEqual({
      action: "update",
      userId: receptionist.userId,
      before: { messageContact: "Laura Gómez" },
      after: { messageContact: null },
    });
  });

  it("writes nothing when the contact asked for is the one already set", async () => {
    const { receptionist, add, contact, history } = await patientWithGuardians();
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
    const { organization, receptionist, practitioner, add, history } = await patientWithGuardians();
    const mother = await add(receptionist, { documentType: "dni", documentNumber: "28123456" });
    await organization.updateGuardian(practitioner, {
      guardianId: mother.id,
      ...laura,
      relationship: "Tutora",
      documentType: "dni",
      documentNumber: "28123456",
    });
    await organization.removeGuardian(adminCaller, { guardianId: mother.id });

    const fields = {
      name: "Laura Gómez",
      documentType: "dni",
      documentNumber: "28123456",
      phone: "+543514123456",
    };
    expect(await history("guardian")).toEqual([
      {
        action: "create",
        userId: receptionist.userId,
        before: null,
        after: { ...fields, relationship: "Madre" },
      },
      {
        action: "update",
        userId: practitioner.userId,
        before: { relationship: "Madre" },
        after: { relationship: "Tutora" },
      },
      {
        action: "delete",
        userId: adminCaller.userId,
        before: { ...fields, relationship: "Tutora" },
        after: null,
      },
    ]);
  });

  it("writes each change of message contact on the patient, the guardian by name", async () => {
    const { receptionist, practitioner, add, contact, history } = await patientWithGuardians();
    const mother = await add(receptionist);
    const father = await add(receptionist, { name: "Pedro Pérez" });
    await contact(mother.id);
    await contact(father.id, practitioner);
    await contact(null, adminCaller);

    expect(
      (await history("patient")).filter((entry) => "messageContact" in (entry.after ?? {})),
    ).toEqual([
      {
        action: "update",
        userId: receptionist.userId,
        before: { messageContact: null },
        after: { messageContact: "Laura Gómez" },
      },
      {
        action: "update",
        userId: practitioner.userId,
        before: { messageContact: "Laura Gómez" },
        after: { messageContact: "Pedro Pérez" },
      },
      {
        action: "update",
        userId: adminCaller.userId,
        before: { messageContact: "Pedro Pérez" },
        after: { messageContact: null },
      },
    ]);
  });
});

describe("minors", () => {
  async function minorOn(instant: string, birthDate: string | null) {
    const { organization, receptionist, patientId } = await patientWithGuardians();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));
    const updated = await organization.updatePatient(receptionist, {
      ...patientFields,
      patientId,
      birthDate,
    });
    const found = await organization.getPatient(receptionist, { patientId });
    vi.useRealTimers();
    if (!updated.ok || !found.ok) {
      throw new Error("updatePatient or getPatient refused");
    }
    expect(updated.patient.minor).toBe(found.patient.minor);
    return { minor: found.patient.minor, incomplete: found.patient.incomplete };
  }

  it("is a minor until their 18th birthday in the organization's time zone", async () => {
    // 23:59 of the eve in Buenos Aires (UTC-3), then midnight of the birthday.
    expect(await minorOn("2026-10-28T02:59:00Z", "2008-10-28")).toMatchObject({ minor: true });
    expect(await minorOn("2026-10-28T03:00:00Z", "2008-10-28")).toMatchObject({ minor: false });
    expect(await minorOn("2026-10-28T03:00:00Z", "2015-06-01")).toMatchObject({ minor: true });
  });

  it("comes of age on 1 March when born on 29 February", async () => {
    expect(await minorOn("2026-03-01T02:59:00Z", "2008-02-29")).toMatchObject({ minor: true });
    expect(await minorOn("2026-03-01T03:00:00Z", "2008-02-29")).toMatchObject({ minor: false });
  });

  it("is not a minor with no birth date, but incomplete", async () => {
    expect(await minorOn("2026-10-28T12:00:00Z", null)).toEqual({
      minor: false,
      incomplete: true,
    });
  });
});
