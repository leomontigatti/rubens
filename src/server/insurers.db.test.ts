import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import type { InsurerInput } from "#/lib/coverages.ts";
import { createOrganization } from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { createInsurer, listInsurers, setInsurerActive, updateInsurer } from "#/server/insurers.ts";

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

const osde: InsurerInput = { name: "OSDE", kind: "prepaga" };

async function create(input: InsurerInput = osde) {
  const result = await asAppRole(db, (tx) => createInsurer(admin, input, tx));
  if (!result.ok) {
    throw new Error(`createInsurer failed: ${result.reason}`);
  }
  return result.insurer;
}

async function list(actor: Actor, includeInactive = false) {
  const result = await asAppRole(db, (tx) => listInsurers(actor, { includeInactive }, tx));
  if (!result.ok) {
    throw new Error(`listInsurers failed: ${result.reason}`);
  }
  return result.insurers;
}

async function entriesFor(entityId: string) {
  return asAppRole(db, (tx) =>
    withTenant(
      admin,
      (tenant) => tenant.select().from(auditLog).where(eq(auditLog.entityId, entityId)),
      tx,
    ),
  );
}

describe("keeping the insurer list", () => {
  it("lets an admin create, rename and list insurers, by name", async () => {
    const created = await create();
    await create({ name: "Apross", kind: "obraSocial" });
    const renamed = await asAppRole(db, (tx) =>
      updateInsurer(admin, { insurerId: created.id, name: "OSDE Binario", kind: "prepaga" }, tx),
    );

    expect(created).toMatchObject({ name: "OSDE", kind: "prepaga", active: true });
    expect(renamed).toMatchObject({ ok: true, insurer: { name: "OSDE Binario" } });
    expect((await list(admin)).map((insurer) => insurer.name)).toEqual(["Apross", "OSDE Binario"]);
  });

  it("refuses a name another insurer of the organization has, whatever its case", async () => {
    const created = await create();
    const other = await create({ name: "Apross", kind: "obraSocial" });

    expect(
      await asAppRole(db, (tx) => createInsurer(admin, { ...osde, name: "osde" }, tx)),
    ).toEqual({ ok: false, reason: "nameTaken" });
    expect(
      await asAppRole(db, (tx) =>
        updateInsurer(admin, { insurerId: other.id, name: "Osde", kind: "prepaga" }, tx),
      ),
    ).toEqual({ ok: false, reason: "nameTaken" });
    expect(
      await asAppRole(db, (tx) =>
        updateInsurer(admin, { insurerId: created.id, name: "OSDE", kind: "obraSocial" }, tx),
      ),
    ).toMatchObject({ ok: true, insurer: { kind: "obraSocial" } });
    expect((await list(admin, true)).map((insurer) => insurer.name)).toEqual(["Apross", "OSDE"]);
  });

  it("refuses insurer changes to anyone but an admin, and lets them read the list", async () => {
    const created = await create();

    for (const actor of [receptionist, practitioner]) {
      expect(await asAppRole(db, (tx) => createInsurer(actor, osde, tx))).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(
        await asAppRole(db, (tx) =>
          updateInsurer(actor, { insurerId: created.id, name: "X", kind: "prepaga" }, tx),
        ),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(
        await asAppRole(db, (tx) => setInsurerActive(actor, { id: created.id, active: false }, tx)),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect((await list(actor)).map((insurer) => insurer.id)).toEqual([created.id]);
    }
  });

  it("answers notFound for an insurer that is not there", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";

    expect(
      await asAppRole(db, (tx) =>
        updateInsurer(admin, { insurerId: missing, name: "X", kind: "prepaga" }, tx),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await asAppRole(db, (tx) => setInsurerActive(admin, { id: missing, active: false }, tx)),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("leaves a deactivated insurer out of the list until asked for, and reactivates it", async () => {
    const created = await create();

    expect(
      await asAppRole(db, (tx) => setInsurerActive(admin, { id: created.id, active: false }, tx)),
    ).toEqual({ ok: true });
    expect(await list(receptionist)).toEqual([]);
    expect(await list(admin, true)).toMatchObject([{ id: created.id, active: false }]);

    await asAppRole(db, (tx) => setInsurerActive(admin, { id: created.id, active: true }, tx));
    expect(await list(receptionist)).toMatchObject([{ id: created.id, active: true }]);
  });

  it("writes each change to the audit log, about no patient", async () => {
    const created = await create();
    await asAppRole(db, (tx) =>
      updateInsurer(admin, { insurerId: created.id, name: "OSDE", kind: "obraSocial" }, tx),
    );
    await asAppRole(db, (tx) => setInsurerActive(admin, { id: created.id, active: false }, tx));
    // Already inactive: nothing changes, nothing is written.
    await asAppRole(db, (tx) => setInsurerActive(admin, { id: created.id, active: false }, tx));

    const entries = await entriesFor(created.id);
    expect(
      entries.map(({ action, entityType, userId, patientId, before, after }) => ({
        action,
        entityType,
        userId,
        patientId,
        before,
        after,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          action: "create",
          entityType: "insurer",
          userId: admin.userId,
          patientId: null,
          before: null,
          after: { name: "OSDE", kind: "prepaga" },
        },
        {
          action: "update",
          entityType: "insurer",
          userId: admin.userId,
          patientId: null,
          before: { kind: "prepaga" },
          after: { kind: "obraSocial" },
        },
        {
          action: "deactivate",
          entityType: "insurer",
          userId: admin.userId,
          patientId: null,
          before: { active: true },
          after: { active: false },
        },
      ]),
    );
    expect(entries).toHaveLength(3);
  });
});
