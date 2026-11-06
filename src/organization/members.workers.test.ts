import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { recordAudit } from "#/organization/audit.ts";
import {
  addMember,
  adminCaller,
  freshOrganization,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import { auditLog, member } from "#/organization/schema.ts";

describe("the organization object's members", () => {
  it("applies its migration on first start and serves the viewer from its tables", async () => {
    const { organizationId, organization } = await setUpTestOrganization();

    const result = await organization.viewer(adminCaller);

    expect(result).toEqual({
      ok: true,
      viewer: {
        userId: adminCaller.userId,
        organizationId,
        organizationName: "Consultorios Prueba",
        name: "Ana Admin",
        email: "ana@example.com",
        roles: ["admin"],
        mustChangePassword: false,
      },
    });
  });

  it("sets an organization up once", async () => {
    const { organizationId, organization } = await setUpTestOrganization();

    const again = await organization.setUp({
      organizationId,
      name: "Otra",
      admin: { userId: "someone-else", name: "Otro", email: "otro@example.com" },
    });

    expect(again).toEqual({ ok: false, reason: "alreadySetUp" });
    expect(await organization.viewer({ userId: "someone-else" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("refuses a user who is not one of its members", async () => {
    const { organization } = await setUpTestOrganization();

    expect(await organization.viewer({ userId: "stranger" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("refuses a member it marks inactive, on their next call", async () => {
    const { organization } = await setUpTestOrganization();
    const receptionist = await addMember(organization, ["receptionist"]);
    expect((await organization.viewer(receptionist)).ok).toBe(true);

    await inStorage(organization, (database) =>
      database
        .update(member)
        .set({ active: false })
        .where(eq(member.userId, receptionist.userId))
        .run(),
    );

    expect(await organization.viewer(receptionist)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("refuses a call that needs a role the member lacks, from its own table", async () => {
    const { organization } = await setUpTestOrganization();
    const receptionist = await addMember(organization, ["receptionist"]);

    const result = await organization.addMember(receptionist, {
      userId: "new-user",
      name: "Nuevo",
      email: "nuevo@example.com",
      roles: ["admin"],
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("takes a role change on the next call", async () => {
    const { organization } = await setUpTestOrganization();
    const promoted = await addMember(organization, ["receptionist"]);

    await inStorage(organization, (database) =>
      database
        .update(member)
        .set({ roles: ["admin"] })
        .where(eq(member.userId, promoted.userId))
        .run(),
    );

    const result = await organization.addMember(promoted, {
      userId: "new-user",
      name: "Nuevo",
      email: "nuevo@example.com",
      roles: ["practitioner"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("refuses every call before it is set up", async () => {
    const { organization } = freshOrganization();

    expect(await organization.viewer(adminCaller)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("refuses a second member with the same email, whatever its case", async () => {
    const { organization } = await setUpTestOrganization();

    const result = await organization.addMember(adminCaller, {
      userId: "other-user",
      name: "Otra Ana",
      email: "ANA@example.com",
      roles: ["receptionist"],
    });

    expect(result).toEqual({ ok: false, reason: "memberExists" });
  });
});

describe("the audit log", () => {
  it("records who added a member, in the same change", async () => {
    const { organization } = await setUpTestOrganization();
    const added = await addMember(organization, ["practitioner"]);

    const entries = await inStorage(organization, (database) =>
      database.select().from(auditLog).where(eq(auditLog.entityId, added.userId)).all(),
    );

    expect(entries).toMatchObject([
      { userId: adminCaller.userId, action: "create", entityType: "member", before: null },
    ]);
  });

  it("rolls an entry back with the change it was written with", async () => {
    const { organization } = await setUpTestOrganization();

    const entries = await inStorage(organization, (database) => {
      const countBefore = database.select().from(auditLog).all().length;
      expect(() =>
        database.transaction((tx) => {
          recordAudit(tx, adminCaller.userId, {
            action: "update",
            entityType: "member",
            entityId: adminCaller.userId,
            patientId: null,
            before: { name: "Ana Admin" },
            after: { name: "Ana" },
          });
          throw new Error("the change failed");
        }),
      ).toThrow("the change failed");
      return { countBefore, countAfter: database.select().from(auditLog).all().length };
    });

    expect(entries.countAfter).toBe(entries.countBefore);
  });
});
