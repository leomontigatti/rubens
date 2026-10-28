import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { coverage } from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import { withTenant } from "#/db/tenant.ts";
import { createAuth } from "#/lib/auth.ts";
import type { CoverageInput } from "#/lib/coverages.ts";
import { createOrganization } from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  addCoverage,
  listCoverages,
  makeCoveragePrimary,
  removeCoverage,
  updateCoverage,
} from "#/server/coverages.ts";
import { createInsurer, setInsurerActive } from "#/server/insurers.ts";
import { getPatientHistory, registerPatient } from "#/server/patients.ts";

// Every call runs as the app role, so row-level security applies as in the app.

let client: PGlite;
let db: TestDatabase;
let admin: Actor;
let receptionist: Actor;
let practitioner: Actor;
let patientId: string;
let osde: string;
let apross: string;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  const { organizationId, adminUserId } = await createOrganization(createAuth(db));
  admin = { organizationId, userId: adminUserId, roles: ["admin"] };
  receptionist = { organizationId, userId: "receptionist", roles: ["receptionist"] };
  practitioner = { organizationId, userId: "practitioner", roles: ["practitioner"] };
  const registered = await asAppRole(db, (tx) =>
    registerPatient(
      receptionist,
      { firstName: "Juan", lastName: "Pérez", phone: "0351 15 555-1234" },
      tx,
    ),
  );
  if (!registered.ok) {
    throw new Error(`registerPatient failed: ${registered.reason}`);
  }
  patientId = registered.patient.id;
  osde = await insurer("OSDE", "prepaga");
  apross = await insurer("Apross", "obraSocial");
});

afterEach(async () => {
  await client.close();
});

async function insurer(name: string, kind: "obraSocial" | "prepaga") {
  const result = await asAppRole(db, (tx) => createInsurer(admin, { name, kind }, tx));
  if (!result.ok) {
    throw new Error(`createInsurer failed: ${result.reason}`);
  }
  return result.insurer.id;
}

async function add(actor: Actor, input: Partial<CoverageInput> = {}) {
  const result = await asAppRole(db, (tx) =>
    addCoverage(actor, { patientId, insurerId: osde, memberNumber: "123", ...input }, tx),
  );
  if (!result.ok) {
    throw new Error(`addCoverage failed: ${result.reason}`);
  }
  return result.coverage;
}

async function coverages(actor: Actor = receptionist) {
  const result = await asAppRole(db, (tx) => listCoverages(actor, { patientId }, tx));
  if (!result.ok) {
    throw new Error(`listCoverages failed: ${result.reason}`);
  }
  return result.coverages;
}

async function coverageHistory() {
  const result = await asAppRole(db, (tx) => getPatientHistory(admin, { patientId }, tx));
  if (!result.ok) {
    throw new Error(`getPatientHistory failed: ${result.reason}`);
  }
  return result.entries
    .filter((entry) => entry.entityType === "coverage")
    .map(({ action, userId, before, after }) => ({ action, userId, before, after }))
    .reverse();
}

describe("a patient's coverages", () => {
  it("lists none for a new patient, who is private", async () => {
    expect(await coverages()).toEqual([]);
  });

  it("lets receptionists, admins and practitioners add coverages, the first one primary", async () => {
    const first = await add(receptionist, { plan: " 310 " });
    await add(admin, { insurerId: apross, memberNumber: "456" });
    await add(practitioner, { insurerId: apross, memberNumber: "789" });

    expect(first).toMatchObject({
      insurerId: osde,
      insurerName: "OSDE",
      insurerKind: "prepaga",
      plan: "310",
      memberNumber: "123",
      primary: true,
    });
    expect(
      (await coverages()).map(({ insurerName, memberNumber, primary }) => ({
        insurerName,
        memberNumber,
        primary,
      })),
    ).toEqual([
      { insurerName: "OSDE", memberNumber: "123", primary: true },
      { insurerName: "Apross", memberNumber: "456", primary: false },
      { insurerName: "Apross", memberNumber: "789", primary: false },
    ]);
  });

  it("moves the primary flag to a coverage added as primary or made primary", async () => {
    const first = await add(receptionist);
    const second = await add(receptionist, { insurerId: apross, primary: true });

    expect((await coverages()).filter((row) => row.primary).map((row) => row.id)).toEqual([
      second.id,
    ]);

    expect(
      await asAppRole(db, (tx) => makeCoveragePrimary(receptionist, { coverageId: first.id }, tx)),
    ).toEqual({ ok: true });
    expect((await coverages()).filter((row) => row.primary).map((row) => row.id)).toEqual([
      first.id,
    ]);
  });

  it("keeps at most one primary coverage per patient in the database", async () => {
    const first = await add(receptionist);

    // Past the services, as the app role.
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          admin,
          (tenant) =>
            tenant.insert(coverage).values({
              organizationId: admin.organizationId,
              patientId,
              insurerId: apross,
              memberNumber: "456",
              primary: true,
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
    expect((await coverages()).map((row) => row.id)).toEqual([first.id]);
  });

  it("edits a coverage's insurer, plan and member number", async () => {
    const added = await add(receptionist, { plan: "310" });

    const result = await asAppRole(db, (tx) =>
      updateCoverage(
        practitioner,
        { coverageId: added.id, insurerId: apross, plan: "", memberNumber: "999" },
        tx,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      coverage: { insurerName: "Apross", plan: null, memberNumber: "999", primary: true },
    });
  });

  it("removes a coverage, handing the primary flag to the oldest one left", async () => {
    const first = await add(receptionist);
    const second = await add(receptionist, { insurerId: apross });
    await add(receptionist, { memberNumber: "777" });

    expect(
      await asAppRole(db, (tx) => removeCoverage(receptionist, { coverageId: first.id }, tx)),
    ).toEqual({ ok: true });

    expect((await coverages()).map(({ id, primary }) => ({ id, primary })).slice(0, 1)).toEqual([
      { id: second.id, primary: true },
    ]);
    expect(await coverages()).toHaveLength(2);
  });

  it("offers no deactivated insurer, and keeps it on the coverages that have it", async () => {
    const added = await add(receptionist);
    await asAppRole(db, (tx) => setInsurerActive(admin, { id: osde, active: false }, tx));

    expect(
      await asAppRole(db, (tx) =>
        addCoverage(receptionist, { patientId, insurerId: osde, memberNumber: "1" }, tx),
      ),
    ).toEqual({ ok: false, reason: "insurerInactive" });
    const other = await add(receptionist, { insurerId: apross });
    expect(
      await asAppRole(db, (tx) =>
        updateCoverage(
          receptionist,
          { coverageId: other.id, insurerId: osde, memberNumber: "1" },
          tx,
        ),
      ),
    ).toEqual({ ok: false, reason: "insurerInactive" });

    // The coverage that already has it keeps it, and can still be edited.
    expect(
      await asAppRole(db, (tx) =>
        updateCoverage(
          receptionist,
          { coverageId: added.id, insurerId: osde, plan: "410", memberNumber: "123" },
          tx,
        ),
      ),
    ).toMatchObject({ ok: true, coverage: { insurerName: "OSDE", insurerActive: false } });
    expect((await coverages()).map((row) => row.insurerName)).toEqual(["OSDE", "Apross"]);
  });

  it("refuses coverage changes to a member with none of the roles", async () => {
    const added = await add(receptionist);
    const nobody: Actor = { ...receptionist, userId: "nobody", roles: [] };

    for (const result of [
      await asAppRole(db, (tx) => listCoverages(nobody, { patientId }, tx)),
      await asAppRole(db, (tx) =>
        addCoverage(nobody, { patientId, insurerId: osde, memberNumber: "1" }, tx),
      ),
      await asAppRole(db, (tx) =>
        updateCoverage(nobody, { coverageId: added.id, insurerId: osde, memberNumber: "1" }, tx),
      ),
      await asAppRole(db, (tx) => makeCoveragePrimary(nobody, { coverageId: added.id }, tx)),
      await asAppRole(db, (tx) => removeCoverage(nobody, { coverageId: added.id }, tx)),
    ]) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("answers notFound for what is not there", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";

    for (const result of [
      await asAppRole(db, (tx) => listCoverages(receptionist, { patientId: missing }, tx)),
      await asAppRole(db, (tx) =>
        addCoverage(receptionist, { patientId: missing, insurerId: osde, memberNumber: "1" }, tx),
      ),
      await asAppRole(db, (tx) =>
        addCoverage(receptionist, { patientId, insurerId: missing, memberNumber: "1" }, tx),
      ),
      await asAppRole(db, (tx) => makeCoveragePrimary(receptionist, { coverageId: missing }, tx)),
      await asAppRole(db, (tx) => removeCoverage(receptionist, { coverageId: missing }, tx)),
    ]) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
  });

  it("writes each coverage change to the patient's history", async () => {
    const first = await add(receptionist, { plan: "310" });
    const second = await add(admin, { insurerId: apross, memberNumber: "456" });
    await asAppRole(db, (tx) =>
      updateCoverage(
        practitioner,
        { coverageId: first.id, insurerId: osde, plan: "410", memberNumber: "123" },
        tx,
      ),
    );
    await asAppRole(db, (tx) => makeCoveragePrimary(receptionist, { coverageId: second.id }, tx));
    await asAppRole(db, (tx) => removeCoverage(receptionist, { coverageId: second.id }, tx));

    // Entries in one transaction share their time, so their order is not asserted.
    const history = await coverageHistory();
    expect(history).toHaveLength(7);
    expect(history).toEqual(
      expect.arrayContaining([
        {
          action: "create",
          userId: "receptionist",
          before: null,
          after: {
            insurerId: osde,
            insurer: "OSDE",
            plan: "310",
            memberNumber: "123",
            primary: true,
          },
        },
        {
          action: "create",
          userId: admin.userId,
          before: null,
          after: { insurerId: apross, insurer: "Apross", memberNumber: "456", primary: false },
        },
        {
          action: "update",
          userId: "practitioner",
          before: { plan: "310" },
          after: { plan: "410" },
        },
        expect.objectContaining({
          action: "update",
          before: { primary: true },
          after: { primary: false },
        }),
        expect.objectContaining({
          action: "update",
          before: { primary: false },
          after: { primary: true },
        }),
        {
          action: "delete",
          userId: "receptionist",
          before: { insurerId: apross, insurer: "Apross", memberNumber: "456", primary: true },
          after: null,
        },
        {
          action: "update",
          userId: "receptionist",
          before: { primary: false },
          after: { primary: true },
        },
      ]),
    );
  });

  it("writes a switch between two insurers of the same name to the history", async () => {
    const otherOsde = await insurer("OSDE", "obraSocial");
    const added = await add(receptionist);
    await asAppRole(db, (tx) =>
      updateCoverage(
        receptionist,
        { coverageId: added.id, insurerId: otherOsde, memberNumber: "123" },
        tx,
      ),
    );

    expect((await coverageHistory()).filter((entry) => entry.action === "update")).toEqual([
      {
        action: "update",
        userId: "receptionist",
        before: { insurerId: osde },
        after: { insurerId: otherOsde },
      },
    ]);
  });
});
