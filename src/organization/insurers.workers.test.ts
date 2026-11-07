import { describe, expect, it } from "vite-plus/test";

import type { InsurerInput } from "#/lib/coverages.ts";

import {
  addMember,
  adminCaller,
  auditEntriesFor,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

const osde: InsurerInput = { name: "OSDE", kind: "prepaga" };
const missing = "00000000-0000-4000-8000-000000000000";

async function create(organization: OrganizationStub, input: InsurerInput = osde) {
  const result = await organization.createInsurer(adminCaller, input);
  if (!result.ok) {
    throw new Error(`createInsurer refused: ${result.reason}`);
  }
  return result.insurer;
}

async function list(
  organization: OrganizationStub,
  caller: typeof adminCaller,
  includeInactive = false,
) {
  const result = await organization.listInsurers(caller, { includeInactive });
  if (!result.ok) {
    throw new Error(`listInsurers refused: ${result.reason}`);
  }
  return result.insurers;
}

describe("keeping the insurer list", () => {
  it("lets an admin create, rename and list insurers, by name", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await create(organization);
    await create(organization, { name: "Apross", kind: "obraSocial" });

    const renamed = await organization.updateInsurer(adminCaller, {
      insurerId: created.id,
      name: "OSDE Binario",
      kind: "prepaga",
    });

    expect(created).toMatchObject({ name: "OSDE", kind: "prepaga", active: true });
    expect(renamed).toMatchObject({ ok: true, insurer: { name: "OSDE Binario" } });
    expect((await list(organization, adminCaller)).map((insurer) => insurer.name)).toEqual([
      "Apross",
      "OSDE Binario",
    ]);
  });

  it("refuses a name another insurer has, whatever its case", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await create(organization);
    const other = await create(organization, { name: "Apross", kind: "obraSocial" });

    expect(await organization.createInsurer(adminCaller, { ...osde, name: "osde" })).toEqual({
      ok: false,
      reason: "nameTaken",
    });
    expect(
      await organization.updateInsurer(adminCaller, {
        insurerId: other.id,
        name: "Osde",
        kind: "prepaga",
      }),
    ).toEqual({ ok: false, reason: "nameTaken" });
    expect(
      await organization.updateInsurer(adminCaller, {
        insurerId: created.id,
        name: "OSDE",
        kind: "obraSocial",
      }),
    ).toMatchObject({ ok: true, insurer: { kind: "obraSocial" } });
    expect((await list(organization, adminCaller, true)).map((insurer) => insurer.name)).toEqual([
      "Apross",
      "OSDE",
    ]);
  });

  it("refuses insurer changes to anyone but an admin, and lets them read the list", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await create(organization);

    for (const roles of [["receptionist"], ["practitioner"]] as const) {
      const caller = await addMember(organization, [...roles]);
      expect(await organization.createInsurer(caller, osde)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(
        await organization.updateInsurer(caller, {
          insurerId: created.id,
          name: "X",
          kind: "prepaga",
        }),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(
        await organization.setInsurerActive(caller, { id: created.id, active: false }),
      ).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect((await list(organization, caller)).map((insurer) => insurer.id)).toEqual([created.id]);
    }
  });

  it("answers notFound for an insurer that is not there", async () => {
    const { organization } = await setUpTestOrganization();

    expect(
      await organization.updateInsurer(adminCaller, {
        insurerId: missing,
        name: "X",
        kind: "prepaga",
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await organization.setInsurerActive(adminCaller, { id: missing, active: false }),
    ).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("leaves a deactivated insurer out of the list until asked for, and reactivates it", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await create(organization);
    const receptionist = await addMember(organization, ["receptionist"]);

    expect(
      await organization.setInsurerActive(adminCaller, { id: created.id, active: false }),
    ).toEqual({
      ok: true,
    });
    expect(await list(organization, receptionist)).toEqual([]);
    expect(await list(organization, adminCaller, true)).toMatchObject([
      { id: created.id, active: false },
    ]);

    await organization.setInsurerActive(adminCaller, { id: created.id, active: true });
    expect(await list(organization, receptionist)).toMatchObject([
      { id: created.id, active: true },
    ]);
  });

  it("says when the default list is empty only because every insurer is inactive", async () => {
    const { organization } = await setUpTestOrganization();
    const receptionist = await addMember(organization, ["receptionist"]);
    const listed = (includeInactive: boolean) =>
      organization.listInsurers(receptionist, { includeInactive });
    const none = await listed(false);
    const created = await create(organization);
    await organization.setInsurerActive(adminCaller, { id: created.id, active: false });

    expect(none).toEqual({ ok: true, insurers: [], onlyInactive: false });
    expect(await listed(false)).toEqual({ ok: true, insurers: [], onlyInactive: true });
    expect(await listed(true)).toMatchObject({ ok: true, onlyInactive: false });
  });

  it("writes each change to the audit log, about no patient", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await create(organization);
    await organization.updateInsurer(adminCaller, {
      insurerId: created.id,
      name: "OSDE",
      kind: "obraSocial",
    });
    await organization.setInsurerActive(adminCaller, { id: created.id, active: false });
    // Already inactive: nothing changes, nothing is written.
    await organization.setInsurerActive(adminCaller, { id: created.id, active: false });

    const about = { entityType: "insurer", userId: adminCaller.userId, patientId: null };
    expect(await auditEntriesFor(organization, created.id)).toEqual([
      { ...about, action: "create", before: null, after: { name: "OSDE", kind: "prepaga" } },
      { ...about, action: "update", before: { kind: "prepaga" }, after: { kind: "obraSocial" } },
      { ...about, action: "deactivate", before: { active: true }, after: { active: false } },
    ]);
  });
});
