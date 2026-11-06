import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Role } from "#/lib/access.ts";

import {
  adminCaller,
  fakeAccounts,
  freshOrganization,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { auditLog } from "#/organization/schema.ts";

// The object reaches Clerk only through its accounts adapter, faked here: each
// test reads what the adapter was asked to do.
vi.mock(import("#/organization/accounts.ts"), async (original) => ({
  ...(await original()),
  accountsFor: () => fakeAccounts,
}));

const startingPassword = "starting-password";

let organization: OrganizationStub;
let organizationId: string;

beforeEach(async () => {
  fakeAccounts.reset();
  ({ organization, organizationId } = await setUpTestOrganization());
});

async function newMember(roles: Role[], email = `${roles.join("-")}@example.com`) {
  const result = await organization.createStaffMember(adminCaller, {
    name: "Juan Gómez",
    email,
    password: startingPassword,
    roles,
  });
  if (!result.ok) {
    throw new Error(`createStaffMember refused: ${result.reason}`);
  }
  return result.member;
}

/** Signs `memberId` past the starting password, as their own change would. */
async function replaceStartingPassword(memberId: string) {
  const changed = await organization.changePassword(
    { userId: memberId },
    { currentPassword: startingPassword, newPassword: "a-new-password" },
  );
  expect(changed).toEqual({ ok: true });
}

const settings = {
  displayName: "Dra. Gómez",
  specialty: "",
  keepsClinicalRecords: false,
  gridMinutes: 20,
  color: "color2",
} as const;

describe("creating a staff member", () => {
  it("asks Clerk for the user, with the organization and the roles", async () => {
    const created = await newMember(["receptionist", "practitioner"]);

    expect(fakeAccounts.calls).toEqual([
      [
        "createUser",
        {
          name: "Juan Gómez",
          email: "receptionist-practitioner@example.com",
          password: startingPassword,
          metadata: { organizationId, roles: ["receptionist", "practitioner"] },
        },
      ],
    ]);
    expect(created).toMatchObject({
      userId: fakeAccounts.lastUserId,
      roles: ["receptionist", "practitioner"],
      active: true,
      practitioner: { displayName: "Juan Gómez", specialty: null, keepsClinicalRecords: true },
    });
    const staff = await organization.listStaff(adminCaller);
    expect(staff.ok && staff.staff.map((member) => member.email)).toEqual([
      "ana@example.com",
      "receptionist-practitioner@example.com",
    ]);
  });

  it("holds the new member to the starting password until they replace it", async () => {
    const created = await newMember(["practitioner"]);

    expect(await organization.listStaff(created)).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    expect(await organization.viewer(created)).toMatchObject({
      ok: true,
      viewer: { mustChangePassword: true },
    });

    await replaceStartingPassword(created.userId);

    expect(await organization.viewer(created)).toMatchObject({
      ok: true,
      viewer: { mustChangePassword: false, roles: ["practitioner"] },
    });
    expect(fakeAccounts.calls.slice(1)).toEqual([
      ["verifyPassword", created.userId, startingPassword],
      ["setPassword", created.userId, "a-new-password"],
    ]);
  });

  it("creates no practitioner row for a member without the role", async () => {
    const created = await newMember(["receptionist"]);

    expect(created.practitioner).toBeNull();
  });

  it("refuses a taken email and a short password, and asks Clerk for nothing", async () => {
    await newMember(["receptionist"], "juan@example.com");
    fakeAccounts.reset();
    const base = { name: "Otro", email: "otro@example.com", password: startingPassword };

    const results = [
      await organization.createStaffMember(adminCaller, {
        ...base,
        email: "Juan@example.com",
        roles: ["admin"],
      }),
      await organization.createStaffMember(adminCaller, {
        ...base,
        password: "short",
        roles: ["admin"],
      }),
    ];

    expect(results).toEqual([
      { ok: false, reason: "emailTaken" },
      { ok: false, reason: "passwordTooShort" },
    ]);
    expect(fakeAccounts.calls).toEqual([]);
  });

  it("creates no member when Clerk refuses the user", async () => {
    fakeAccounts.refuseNext("emailTaken");

    expect(
      await organization.createStaffMember(adminCaller, {
        name: "Otro",
        email: "otro@example.com",
        password: startingPassword,
        roles: ["receptionist"],
      }),
    ).toEqual({ ok: false, reason: "emailTaken" });
    const staff = await organization.listStaff(adminCaller);
    expect(staff.ok && staff.staff).toHaveLength(1);
  });

  it("deletes the Clerk user when the email is taken while Clerk answers", async () => {
    const release = fakeAccounts.hold("createUser");
    const creating = organization.createStaffMember(adminCaller, {
      name: "Otro",
      email: "otro@example.com",
      password: startingPassword,
      roles: ["receptionist"],
    });
    await vi.waitUntil(() => fakeAccounts.calls.length > 0);
    const orphan = fakeAccounts.lastUserId!;
    await organization.addMember(adminCaller, {
      userId: "user-other",
      name: "Otro",
      email: "otro@example.com",
      roles: ["receptionist"],
    });
    release();

    expect(await creating).toEqual({ ok: false, reason: "emailTaken" });
    expect(fakeAccounts.calls.at(-1)).toEqual(["deleteUser", orphan]);
    expect(fakeAccounts.hasUser(orphan)).toBe(false);
  });

  it("adopts the Clerk user an earlier create of this organization left without a member", async () => {
    const orphan = fakeAccounts.addUser("otro@example.com", { organizationId, roles: ["admin"] });

    const created = await organization.createStaffMember(adminCaller, {
      name: "Otro",
      email: "otro@example.com",
      password: startingPassword,
      roles: ["receptionist"],
    });

    expect(created).toMatchObject({
      ok: true,
      member: { userId: orphan, roles: ["receptionist"] },
    });
    expect(fakeAccounts.calls.slice(1)).toEqual([
      ["findUserByEmail", "otro@example.com"],
      ["setPassword", orphan, startingPassword],
      ["updateMetadata", orphan, { organizationId, roles: ["receptionist"] }],
    ]);
  });

  it("does not adopt a Clerk user of another organization", async () => {
    fakeAccounts.addUser("otro@example.com", { organizationId: "other", roles: ["admin"] });

    expect(
      await organization.createStaffMember(adminCaller, {
        name: "Otro",
        email: "otro@example.com",
        password: startingPassword,
        roles: ["receptionist"],
      }),
    ).toEqual({ ok: false, reason: "emailTaken" });
    expect(fakeAccounts.calls.map(([method]) => method)).toEqual(["createUser", "findUserByEmail"]);
  });
});

describe("changing roles", () => {
  it("takes effect on the member's next call, and is mirrored to Clerk", async () => {
    const created = await newMember(["receptionist"]);
    await replaceStartingPassword(created.userId);
    expect(await organization.listStaff(created)).toEqual({ ok: false, reason: "forbidden" });
    fakeAccounts.reset();

    const saved = await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      roles: ["admin", "receptionist"],
    });

    expect(saved).toMatchObject({ ok: true, member: { roles: ["admin", "receptionist"] } });
    expect((await organization.listStaff(created)).ok).toBe(true);
    expect(fakeAccounts.calls).toEqual([
      ["updateMetadata", created.userId, { roles: ["admin", "receptionist"] }],
    ]);
    const entries = await inStorage(organization, (database) =>
      database.select().from(auditLog).all(),
    );
    expect(entries.at(-1)).toMatchObject({
      action: "update",
      entityType: "member",
      entityId: created.userId,
      userId: adminCaller.userId,
      before: { roles: "receptionist" },
      after: { roles: "admin,receptionist" },
    });
  });

  it("creates the practitioner row when the role is granted, and keeps it when removed", async () => {
    const created = await newMember(["receptionist"]);

    const granted = await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      roles: ["practitioner", "receptionist"],
    });
    const removed = await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      roles: ["receptionist"],
    });

    expect(granted).toMatchObject({
      ok: true,
      member: {
        roles: ["receptionist", "practitioner"],
        practitioner: { displayName: "Juan Gómez" },
      },
    });
    expect(removed).toMatchObject({
      ok: true,
      member: { roles: ["receptionist"], practitioner: { displayName: "Juan Gómez" } },
    });
  });

  it("gives each new practitioner the next colour of the palette", async () => {
    const first = await newMember(["practitioner"], "first@example.com");
    const second = await newMember(["receptionist"], "second@example.com");
    const granted = await organization.updateMember(adminCaller, {
      memberId: second.memberId,
      roles: ["practitioner"],
    });

    expect(first.practitioner?.color).toBe("color1");
    expect(granted.ok && granted.member.practitioner?.color).toBe("color2");
  });

  it("answers notFound for practitioner settings of a member who never was one", async () => {
    const created = await newMember(["receptionist"]);

    expect(
      await organization.updateMember(adminCaller, {
        memberId: created.memberId,
        roles: ["admin"],
        practitioner: settings,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    const after = await organization.getStaffMember(adminCaller, { memberId: created.memberId });
    expect(after.ok && after.member.roles).toEqual(["receptionist"]);
  });

  it("saves the roles and the practitioner settings together", async () => {
    const created = await newMember(["practitioner"]);

    const saved = await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      roles: ["practitioner", "receptionist"],
      practitioner: settings,
    });

    expect(saved).toMatchObject({
      ok: true,
      member: {
        roles: ["receptionist", "practitioner"],
        practitioner: { displayName: "Dra. Gómez", specialty: null, gridMinutes: 20 },
      },
    });
  });

  it("leaves the roles as they are when a save carries none, and asks Clerk for nothing", async () => {
    const created = await newMember(["practitioner", "receptionist"]);
    fakeAccounts.reset();

    const saved = await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      practitioner: settings,
    });

    expect(saved).toMatchObject({
      ok: true,
      member: {
        roles: ["receptionist", "practitioner"],
        practitioner: { displayName: "Dra. Gómez" },
      },
    });
    expect(fakeAccounts.calls).toEqual([]);
  });

  it("records the changed practitioner settings in the audit log", async () => {
    const created = await newMember(["practitioner"]);

    await organization.updateMember(adminCaller, {
      memberId: created.memberId,
      practitioner: { ...settings, specialty: "Pediatría" },
    });

    const entries = await inStorage(organization, (database) =>
      database.select().from(auditLog).where(eq(auditLog.entityType, "practitioner")).all(),
    );
    expect(entries).toMatchObject([
      {
        action: "update",
        userId: adminCaller.userId,
        before: {
          displayName: "Juan Gómez",
          specialty: null,
          keepsClinicalRecords: true,
          gridMinutes: 30,
          color: "color1",
        },
        after: {
          displayName: "Dra. Gómez",
          specialty: "Pediatría",
          keepsClinicalRecords: false,
          gridMinutes: 20,
          color: "color2",
        },
      },
    ]);
  });
});

describe("the last admin", () => {
  it("can neither lose the admin role nor be deactivated, and nothing is saved", async () => {
    await organization.updateMember(adminCaller, {
      memberId: adminCaller.userId,
      roles: ["admin", "practitioner"],
    });
    fakeAccounts.reset();

    const results = [
      await organization.updateMember(adminCaller, {
        memberId: adminCaller.userId,
        roles: ["practitioner"],
        practitioner: settings,
      }),
      await organization.setMemberActive(adminCaller, {
        memberId: adminCaller.userId,
        active: false,
      }),
    ];

    expect(results).toEqual([
      { ok: false, reason: "lastAdmin" },
      { ok: false, reason: "lastAdmin" },
    ]);
    expect(
      await organization.getStaffMember(adminCaller, { memberId: adminCaller.userId }),
    ).toMatchObject({
      ok: true,
      member: {
        roles: ["admin", "practitioner"],
        active: true,
        practitioner: { displayName: "Ana Admin" },
      },
    });
    expect(fakeAccounts.calls).toEqual([]);
  });

  it("counts only active admins", async () => {
    const other = await newMember(["admin"]);
    await organization.setMemberActive(adminCaller, { memberId: other.memberId, active: false });

    expect(
      await organization.updateMember(adminCaller, {
        memberId: adminCaller.userId,
        roles: ["receptionist"],
      }),
    ).toEqual({ ok: false, reason: "lastAdmin" });
  });

  it("lets an admin step down while another active admin remains", async () => {
    await newMember(["admin"]);

    expect(
      await organization.updateMember(adminCaller, {
        memberId: adminCaller.userId,
        roles: ["practitioner"],
      }),
    ).toMatchObject({ ok: true, member: { roles: ["practitioner"] } });
  });
});

describe("deactivating a member", () => {
  it("refuses their next call, asks Clerk to ban them, and deletes nothing", async () => {
    const created = await newMember(["receptionist"]);
    await replaceStartingPassword(created.userId);
    fakeAccounts.reset();

    const result = await organization.setMemberActive(adminCaller, {
      memberId: created.memberId,
      active: false,
    });

    expect(result).toEqual({ ok: true });
    expect(await organization.viewer(created)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(fakeAccounts.calls).toEqual([["ban", created.userId]]);
    expect(
      await organization.getStaffMember(adminCaller, { memberId: created.memberId }),
    ).toMatchObject({ ok: true, member: { email: created.email, active: false } });
  });

  it("lets a reactivated member back in, and asks Clerk to lift the ban", async () => {
    const created = await newMember(["receptionist"]);
    await organization.setMemberActive(adminCaller, { memberId: created.memberId, active: false });
    fakeAccounts.reset();

    await organization.setMemberActive(adminCaller, { memberId: created.memberId, active: true });

    expect((await organization.viewer(created)).ok).toBe(true);
    expect(fakeAccounts.calls).toEqual([["unban", created.userId]]);
    const entries = await inStorage(organization, (database) =>
      database.select().from(auditLog).all(),
    );
    expect(entries.slice(-2).map((entry) => entry.action)).toEqual(["deactivate", "reactivate"]);
  });

  it("leaves the Clerk user unbanned when another admin reactivates while Clerk bans", async () => {
    const created = await newMember(["receptionist"]);
    fakeAccounts.reset();
    const release = fakeAccounts.hold("ban");

    const deactivating = organization.setMemberActive(adminCaller, {
      memberId: created.memberId,
      active: false,
    });
    await vi.waitUntil(() => fakeAccounts.calls.length > 0);
    await organization.setMemberActive(adminCaller, { memberId: created.memberId, active: true });
    release();
    await deactivating;

    expect(fakeAccounts.calls.at(-1)).toEqual(["unban", created.userId]);
    expect((await organization.viewer(created)).ok).toBe(true);
  });
});

describe("passwords", () => {
  it("gives a member a new starting password, which they must replace again", async () => {
    const created = await newMember(["receptionist"]);
    await replaceStartingPassword(created.userId);
    fakeAccounts.reset();

    const result = await organization.setStartingPassword(adminCaller, {
      memberId: created.memberId,
      password: "another-start",
    });

    expect(result).toEqual({ ok: true });
    expect(fakeAccounts.calls).toEqual([["setPassword", created.userId, "another-start"]]);
    expect(await organization.listStaff(created)).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
  });

  it("refuses a starting password that is too short", async () => {
    const created = await newMember(["receptionist"]);

    expect(
      await organization.setStartingPassword(adminCaller, {
        memberId: created.memberId,
        password: "short",
      }),
    ).toEqual({ ok: false, reason: "passwordTooShort" });
  });

  it("refuses a wrong current password, or the same one, and keeps the hold", async () => {
    const created = await newMember(["receptionist"]);
    fakeAccounts.rejectPasswords();

    const results = [
      await organization.changePassword(created, {
        currentPassword: "wrong-password",
        newPassword: "a-new-password",
      }),
      await organization.changePassword(created, {
        currentPassword: startingPassword,
        newPassword: startingPassword,
      }),
    ];

    expect(results).toEqual([
      { ok: false, reason: "wrongPassword" },
      { ok: false, reason: "samePassword" },
    ]);
    expect(await organization.viewer(created)).toMatchObject({
      viewer: { mustChangePassword: true },
    });
  });

  it("lets any member change their own password at any time", async () => {
    const created = await newMember(["practitioner"]);
    await replaceStartingPassword(created.userId);

    expect(
      await organization.changePassword(created, {
        currentPassword: "a-new-password",
        newPassword: "another-password",
      }),
    ).toEqual({ ok: true });
  });
});

describe("refusals", () => {
  it("refuses every staff call to anyone without the admin role, and changes nothing", async () => {
    const created = await newMember(["receptionist", "practitioner"]);
    await replaceStartingPassword(created.userId);
    fakeAccounts.reset();
    const memberId = created.memberId;

    const results = [
      await organization.listStaff(created),
      await organization.getStaffMember(created, { memberId }),
      await organization.createStaffMember(created, {
        name: "X",
        email: "x@example.com",
        password: startingPassword,
        roles: ["admin"],
      }),
      await organization.updateMember(created, { memberId, roles: ["admin"] }),
      await organization.setMemberActive(created, { memberId: adminCaller.userId, active: false }),
      await organization.setStartingPassword(created, {
        memberId: adminCaller.userId,
        password: "x-password",
      }),
    ];

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
    expect(fakeAccounts.calls).toEqual([]);
    expect(await organization.getStaffMember(adminCaller, { memberId })).toMatchObject({
      ok: true,
      member: { roles: ["receptionist", "practitioner"], active: true },
    });
  });

  it("answers notFound for a member of another organization", async () => {
    const created = await newMember(["practitioner"]);
    const other = freshOrganization().organization;
    await other.setUp({
      organizationId: "other",
      name: "Otra",
      admin: { userId: adminCaller.userId, name: "Ana Admin", email: "ana@example.com" },
    });

    const results = [
      await other.getStaffMember(adminCaller, { memberId: created.memberId }),
      await other.updateMember(adminCaller, { memberId: created.memberId, roles: ["admin"] }),
      await other.setMemberActive(adminCaller, { memberId: created.memberId, active: false }),
      await other.setStartingPassword(adminCaller, {
        memberId: created.memberId,
        password: "x-password",
      }),
    ];

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
  });
});

describe("setting an organization up", () => {
  it("creates its first admin's Clerk user and member, who must replace the starting password", async () => {
    const { organization: fresh } = freshOrganization();
    fakeAccounts.reset();

    const result = await fresh.setUpWithAccount({
      organizationId: "consultorios-belgrano",
      name: "Consultorios Belgrano",
      admin: { name: "Ana Gómez", email: "Ana@Example.com", password: startingPassword },
    });

    expect(result).toEqual({ ok: true, userId: fakeAccounts.lastUserId });
    expect(fakeAccounts.calls).toEqual([
      [
        "createUser",
        {
          name: "Ana Gómez",
          email: "ana@example.com",
          password: startingPassword,
          metadata: { organizationId: "consultorios-belgrano", roles: ["admin"] },
        },
      ],
    ]);
    expect(await fresh.viewer({ userId: fakeAccounts.lastUserId! })).toMatchObject({
      ok: true,
      viewer: {
        organizationId: "consultorios-belgrano",
        organizationName: "Consultorios Belgrano",
        roles: ["admin"],
        mustChangePassword: true,
      },
    });
  });

  it("changes nothing, and creates no user, when the organization is already set up", async () => {
    fakeAccounts.reset();

    expect(
      await organization.setUpWithAccount({
        organizationId,
        name: "Otra",
        admin: { name: "Otro", email: "otro@example.com", password: startingPassword },
      }),
    ).toEqual({ ok: false, reason: "alreadySetUp" });
    expect(fakeAccounts.calls).toEqual([]);
  });
});
