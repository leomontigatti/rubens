import { describe, expect, it } from "vite-plus/test";

import type { CoverageInput } from "#/lib/coverages.ts";
import { historyChanges } from "#/lib/patients.ts";

import {
  addMember,
  adminCaller,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { coverage } from "#/organization/schema.ts";

const missing = "00000000-0000-4000-8000-000000000000";

/** A registered patient, two insurers, and a receptionist and a practitioner. */
async function patientWithInsurers() {
  const { organization } = await setUpTestOrganization();
  const receptionist = await addMember(organization, ["receptionist"]);
  const practitioner = await addMember(organization, ["practitioner"]);
  const registered = await organization.registerPatient(receptionist, {
    firstName: "Juan",
    lastName: "Pérez",
    phone: { country: "AR", number: "3515551234" },
  });
  if (!registered.ok) {
    throw new Error(`registerPatient refused: ${registered.reason}`);
  }
  const insurer = async (name: string, kind: "obraSocial" | "prepaga") => {
    const result = await organization.createInsurer(adminCaller, { name, kind });
    if (!result.ok) {
      throw new Error(`createInsurer refused: ${result.reason}`);
    }
    return result.insurer.id;
  };
  const osde = await insurer("OSDE", "prepaga");
  const apross = await insurer("Apross", "obraSocial");
  const patientId = registered.patient.id;

  const add = async (caller: typeof adminCaller, input: Partial<CoverageInput> = {}) => {
    const result = await organization.addCoverage(caller, {
      patientId,
      insurerId: osde,
      memberNumber: "123",
      ...input,
    });
    if (!result.ok) {
      throw new Error(`addCoverage refused: ${result.reason}`);
    }
    return result.coverage;
  };
  const coverages = async () => {
    const result = await organization.listCoverages(receptionist, { patientId });
    if (!result.ok) {
      throw new Error(`listCoverages refused: ${result.reason}`);
    }
    return result.coverages;
  };
  return {
    organization,
    receptionist,
    practitioner,
    patientId,
    osde,
    apross,
    insurer,
    add,
    coverages,
  };
}

/** The patient's coverage entries, oldest first. */
async function coverageHistory(organization: OrganizationStub, patientId: string) {
  const result = await organization.getPatientHistory(adminCaller, { patientId });
  if (!result.ok) {
    throw new Error(`getPatientHistory refused: ${result.reason}`);
  }
  return result.entries
    .filter((entry) => entry.entityType === "coverage")
    .map(({ action, userId, before, after }) => ({ action, userId, before, after }))
    .reverse();
}

describe("a patient's coverage", () => {
  it("lists none for a new patient, who is private", async () => {
    const { coverages } = await patientWithInsurers();

    expect(await coverages()).toEqual([]);
  });

  it("lets receptionists, admins and practitioners add the patient's one coverage", async () => {
    const { organization, receptionist, practitioner, osde, apross, add, coverages } =
      await patientWithInsurers();

    const added = await add(receptionist, { plan: " 310 " });

    expect(added).toEqual({
      id: added.id,
      patientId: added.patientId,
      insurerId: osde,
      insurerName: "OSDE",
      insurerKind: "prepaga",
      insurerActive: true,
      plan: "310",
      memberNumber: "123",
    });
    expect(await coverages()).toEqual([added]);

    for (const caller of [adminCaller, practitioner]) {
      await organization.removeCoverage(receptionist, { coverageId: (await coverages())[0]!.id });
      await add(caller, { insurerId: apross });
    }
    expect((await coverages()).map((row) => row.insurerName)).toEqual(["Apross"]);
  });

  it("refuses a second coverage to a patient who has one", async () => {
    const { organization, receptionist, patientId, apross, add, coverages } =
      await patientWithInsurers();
    const first = await add(receptionist);

    expect(
      await organization.addCoverage(receptionist, {
        patientId,
        insurerId: apross,
        memberNumber: "456",
      }),
    ).toEqual({ ok: false, reason: "hasCoverage" });
    expect((await coverages()).map((row) => row.id)).toEqual([first.id]);
  });

  it("keeps at most one coverage per patient in storage", async () => {
    const { organization, receptionist, patientId, apross, add, coverages } =
      await patientWithInsurers();
    const first = await add(receptionist);

    // Past the object's methods, on its storage.
    await expect(
      inStorage(organization, (database) =>
        database
          .insert(coverage)
          .values({ patientId, insurerId: apross, memberNumber: "456" })
          .run(),
      ),
    ).rejects.toThrow();
    expect((await coverages()).map((row) => row.id)).toEqual([first.id]);
  });

  it("edits the coverage's insurer, plan and member number", async () => {
    const { organization, receptionist, practitioner, apross, add } = await patientWithInsurers();
    const added = await add(receptionist, { plan: "310" });

    const result = await organization.updateCoverage(practitioner, {
      coverageId: added.id,
      insurerId: apross,
      plan: "",
      memberNumber: "999",
    });

    expect(result).toMatchObject({
      ok: true,
      coverage: { insurerName: "Apross", plan: null, memberNumber: "999" },
    });
  });

  it("removes the coverage, leaving the patient private", async () => {
    const { organization, receptionist, add, coverages } = await patientWithInsurers();
    const added = await add(receptionist);

    expect(await organization.removeCoverage(receptionist, { coverageId: added.id })).toEqual({
      ok: true,
    });

    expect(await coverages()).toEqual([]);
  });

  it("offers no deactivated insurer, and keeps it on the coverage that has it", async () => {
    const { organization, receptionist, patientId, osde, apross, add, coverages } =
      await patientWithInsurers();
    const added = await add(receptionist);
    await organization.setInsurerActive(adminCaller, { id: osde, active: false });

    // The coverage that already has it keeps it, and can still be edited.
    expect(
      await organization.updateCoverage(receptionist, {
        coverageId: added.id,
        insurerId: osde,
        plan: "410",
        memberNumber: "123",
      }),
    ).toMatchObject({ ok: true, coverage: { insurerName: "OSDE", insurerActive: false } });
    expect((await coverages()).map((row) => row.insurerName)).toEqual(["OSDE"]);

    await organization.updateCoverage(receptionist, {
      coverageId: added.id,
      insurerId: apross,
      memberNumber: "123",
    });
    expect(
      await organization.updateCoverage(receptionist, {
        coverageId: added.id,
        insurerId: osde,
        memberNumber: "1",
      }),
    ).toEqual({ ok: false, reason: "insurerInactive" });

    await organization.removeCoverage(receptionist, { coverageId: added.id });
    expect(
      await organization.addCoverage(receptionist, {
        patientId,
        insurerId: osde,
        memberNumber: "1",
      }),
    ).toEqual({ ok: false, reason: "insurerInactive" });
  });

  it("refuses coverage calls to a caller who is not a member", async () => {
    const { organization, receptionist, patientId, osde, add } = await patientWithInsurers();
    const added = await add(receptionist);
    const stranger = { userId: "user-stranger" };

    for (const result of [
      await organization.listCoverages(stranger, { patientId }),
      await organization.addCoverage(stranger, { patientId, insurerId: osde, memberNumber: "1" }),
      await organization.updateCoverage(stranger, {
        coverageId: added.id,
        insurerId: osde,
        memberNumber: "1",
      }),
      await organization.removeCoverage(stranger, { coverageId: added.id }),
    ]) {
      expect(result).toEqual({ ok: false, reason: "unauthenticated" });
    }
  });

  it("answers notFound for what is not there", async () => {
    const { organization, receptionist, patientId, osde } = await patientWithInsurers();

    for (const result of [
      await organization.listCoverages(receptionist, { patientId: missing }),
      await organization.addCoverage(receptionist, {
        patientId: missing,
        insurerId: osde,
        memberNumber: "1",
      }),
      await organization.addCoverage(receptionist, {
        patientId,
        insurerId: missing,
        memberNumber: "1",
      }),
      await organization.updateCoverage(receptionist, {
        coverageId: missing,
        insurerId: osde,
        memberNumber: "1",
      }),
      await organization.removeCoverage(receptionist, { coverageId: missing }),
    ]) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
  });

  it("writes each coverage change to the patient's history, in order", async () => {
    const { organization, receptionist, practitioner, patientId, osde, apross, add } =
      await patientWithInsurers();
    const first = await add(receptionist, { plan: "310" });
    await organization.updateCoverage(practitioner, {
      coverageId: first.id,
      insurerId: osde,
      plan: "410",
      memberNumber: "123",
    });
    await organization.removeCoverage(receptionist, { coverageId: first.id });
    await add(adminCaller, { insurerId: apross, memberNumber: "456" });

    expect(await coverageHistory(organization, patientId)).toEqual([
      {
        action: "create",
        userId: receptionist.userId,
        before: null,
        after: { insurerId: osde, insurer: "OSDE", plan: "310", memberNumber: "123" },
      },
      {
        action: "update",
        userId: practitioner.userId,
        before: { plan: "310" },
        after: { plan: "410" },
      },
      {
        action: "delete",
        userId: receptionist.userId,
        before: { insurerId: osde, insurer: "OSDE", plan: "410", memberNumber: "123" },
        after: null,
      },
      {
        action: "create",
        userId: adminCaller.userId,
        before: null,
        after: { insurerId: apross, insurer: "Apross", memberNumber: "456" },
      },
    ]);
  });

  it("writes a switch of insurer to the history, by name", async () => {
    const { organization, receptionist, patientId, osde, insurer, add } =
      await patientWithInsurers();
    const swiss = await insurer("Swiss Medical", "prepaga");
    const added = await add(receptionist);
    await organization.updateCoverage(receptionist, {
      coverageId: added.id,
      insurerId: swiss,
      memberNumber: "123",
    });

    const updates = (await coverageHistory(organization, patientId)).filter(
      (entry) => entry.action === "update",
    );
    expect(updates).toEqual([
      {
        action: "update",
        userId: receptionist.userId,
        before: { insurerId: osde, insurer: "OSDE" },
        after: { insurerId: swiss, insurer: "Swiss Medical" },
      },
    ]);
    expect(historyChanges(updates[0]!)).toEqual([
      { field: "Obra social / prepaga", before: "OSDE", after: "Swiss Medical" },
    ]);
  });
});
