import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor, Role } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import type { Auth } from "#/lib/auth.ts";
import {
  clearMustChangePassword,
  createOrganization,
  startingPassword,
} from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { authorize } from "./actor.ts";
import {
  changeRoles,
  createStaffMember,
  getStaffMember,
  listStaff,
  setMemberActive,
  setStartingPassword,
  updatePractitioner,
} from "./staff.ts";

// Every service call runs as the app role, so row-level security applies as in
// the app. Sign-in and sessions go through Better Auth on the same database.

let client: PGlite;
let db: TestDatabase;
let auth: Auth;
let admin: Actor;
let adminMemberId: string;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  auth = createAuth(db);
  const { organizationId, adminUserId } = await createOrganization(auth);
  admin = { organizationId, userId: adminUserId, roles: ["admin"] };
  const staff = await asAppRole(db, (tx) => listStaff(admin, tx));
  adminMemberId = staff.ok ? staff.staff[0]!.memberId : "";
});

afterEach(async () => {
  await client.close();
});

async function newMember(roles: Role[], email = `${roles.join("-")}@example.com`) {
  const result = await asAppRole(db, (tx) =>
    createStaffMember(admin, { name: "Juan Gómez", email, password: startingPassword, roles }, tx),
  );
  if (!result.ok) {
    throw new Error(`createStaffMember failed: ${result.reason}`);
  }
  return result.member;
}

async function signIn(email: string, password = startingPassword) {
  const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return new Headers({ cookie: result.headers.get("set-cookie") ?? "" });
}

describe("creating a staff member", () => {
  it("creates an account with several roles, who must change the starting password", async () => {
    const created = await newMember(["receptionist", "practitioner"]);

    expect(created).toMatchObject({
      name: "Juan Gómez",
      email: "receptionist-practitioner@example.com",
      roles: ["receptionist", "practitioner"],
      active: true,
      practitioner: { displayName: "Juan Gómez", specialty: null, keepsClinicalRecords: true },
    });
    await signIn(created.email);
    expect(await authorize(auth, created.userId, { roles: "any" })).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    await clearMustChangePassword(auth, created.userId);
    expect(await authorize(auth, created.userId, { roles: ["practitioner"] })).toEqual({
      ok: true,
      actor: {
        organizationId: admin.organizationId,
        userId: created.userId,
        roles: ["receptionist", "practitioner"],
      },
    });
  });

  it("creates no practitioner row for a member without the role", async () => {
    const created = await newMember(["receptionist"]);

    expect(created.practitioner).toBeNull();
  });

  it("refuses a taken email and a short password, and creates nothing", async () => {
    await newMember(["receptionist"], "juan@example.com");
    const base = { name: "Otro", email: "otro@example.com", password: startingPassword };

    const results = await asAppRole(db, async (tx) => [
      await createStaffMember(admin, { ...base, email: "Juan@example.com", roles: ["admin"] }, tx),
      await createStaffMember(admin, { ...base, password: "short", roles: ["admin"] }, tx),
    ]);

    expect(results).toEqual([
      { ok: false, reason: "emailTaken" },
      { ok: false, reason: "passwordTooShort" },
    ]);
    const staff = await asAppRole(db, (tx) => listStaff(admin, tx));
    expect(staff.ok && staff.staff.map((member) => member.email)).toEqual([
      "ana@consultorios-belgrano.example.com",
      "juan@example.com",
    ]);
  });
});

describe("changing roles", () => {
  it("creates the practitioner row when the role is granted, and keeps it when removed", async () => {
    const created = await newMember(["receptionist"]);

    const granted = await asAppRole(db, (tx) =>
      changeRoles(
        admin,
        { memberId: created.memberId, roles: ["practitioner", "receptionist"] },
        tx,
      ),
    );
    await asAppRole(db, (tx) =>
      updatePractitioner(
        admin,
        {
          memberId: created.memberId,
          displayName: "Dr. Gómez",
          specialty: "Ortodoncia",
          keepsClinicalRecords: false,
        },
        tx,
      ),
    );
    const removed = await asAppRole(db, (tx) =>
      changeRoles(admin, { memberId: created.memberId, roles: ["receptionist"] }, tx),
    );
    const regranted = await asAppRole(db, (tx) =>
      changeRoles(admin, { memberId: created.memberId, roles: ["practitioner"] }, tx),
    );

    expect(granted).toMatchObject({
      ok: true,
      member: {
        roles: ["receptionist", "practitioner"],
        practitioner: { displayName: "Juan Gómez", keepsClinicalRecords: true },
      },
    });
    expect(removed).toMatchObject({
      ok: true,
      member: { roles: ["receptionist"], practitioner: { displayName: "Dr. Gómez" } },
    });
    expect(regranted).toMatchObject({
      ok: true,
      member: {
        roles: ["practitioner"],
        practitioner: {
          displayName: "Dr. Gómez",
          specialty: "Ortodoncia",
          keepsClinicalRecords: false,
        },
      },
    });
    expect(
      await authorize(auth, created.userId, { roles: "any", passwordChange: "allowed" }),
    ).toMatchObject({ ok: true, actor: { roles: ["practitioner"] } });
  });

  it("answers notFound for practitioner settings of a member who never was one", async () => {
    const created = await newMember(["receptionist"]);

    expect(
      await asAppRole(db, (tx) =>
        updatePractitioner(
          admin,
          {
            memberId: created.memberId,
            displayName: "X",
            specialty: "",
            keepsClinicalRecords: true,
          },
          tx,
        ),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("the last admin", () => {
  it("can neither lose the admin role nor be deactivated", async () => {
    const results = await asAppRole(db, async (tx) => [
      await changeRoles(admin, { memberId: adminMemberId, roles: ["practitioner"] }, tx),
      await setMemberActive(admin, { memberId: adminMemberId, active: false }, tx),
    ]);

    expect(results).toEqual([
      { ok: false, reason: "lastAdmin" },
      { ok: false, reason: "lastAdmin" },
    ]);
    const member = await asAppRole(db, (tx) =>
      getStaffMember(admin, { memberId: adminMemberId }, tx),
    );
    expect(member).toMatchObject({ ok: true, member: { roles: ["admin"], active: true } });
  });

  it("counts only active admins", async () => {
    const other = await newMember(["admin"]);
    await asAppRole(db, (tx) =>
      setMemberActive(admin, { memberId: other.memberId, active: false }, tx),
    );

    expect(
      await asAppRole(db, (tx) =>
        changeRoles(admin, { memberId: adminMemberId, roles: ["receptionist"] }, tx),
      ),
    ).toEqual({ ok: false, reason: "lastAdmin" });
  });

  it("lets an admin step down while another active admin remains", async () => {
    await newMember(["admin"]);

    expect(
      await asAppRole(db, (tx) =>
        changeRoles(admin, { memberId: adminMemberId, roles: ["practitioner"] }, tx),
      ),
    ).toMatchObject({ ok: true, member: { roles: ["practitioner"] } });
  });
});

describe("deactivating a member", () => {
  it("ends their sessions, refuses their sign-in and their calls, and deletes nothing", async () => {
    const created = await newMember(["receptionist"]);
    await clearMustChangePassword(auth, created.userId);
    const headers = await signIn(created.email);

    const result = await asAppRole(db, (tx) =>
      setMemberActive(admin, { memberId: created.memberId, active: false }, tx),
    );

    expect(result).toEqual({ ok: true });
    expect(await auth.api.getSession({ headers })).toBeNull();
    await expect(signIn(created.email)).rejects.toMatchObject({ statusCode: 403 });
    expect(await authorize(auth, created.userId, { roles: "any" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(
      await asAppRole(db, (tx) => getStaffMember(admin, { memberId: created.memberId }, tx)),
    ).toMatchObject({ ok: true, member: { email: created.email, active: false } });
  });

  it("lets a reactivated member sign in again", async () => {
    const created = await newMember(["receptionist"]);
    await asAppRole(db, (tx) =>
      setMemberActive(admin, { memberId: created.memberId, active: false }, tx),
    );

    await asAppRole(db, (tx) =>
      setMemberActive(admin, { memberId: created.memberId, active: true }, tx),
    );

    const headers = await signIn(created.email);
    expect(await auth.api.getSession({ headers })).toMatchObject({
      user: { id: created.userId },
    });
  });
});

describe("setting a new starting password", () => {
  it("replaces the password and makes the member change it again", async () => {
    const created = await newMember(["receptionist"]);
    await clearMustChangePassword(auth, created.userId);

    const result = await asAppRole(db, (tx) =>
      setStartingPassword(admin, { memberId: created.memberId, password: "another-start" }, tx),
    );

    expect(result).toEqual({ ok: true });
    await expect(signIn(created.email)).rejects.toMatchObject({ statusCode: 401 });
    await signIn(created.email, "another-start");
    expect(await authorize(auth, created.userId, { roles: "any" })).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
  });

  it("refuses a password that is too short", async () => {
    const created = await newMember(["receptionist"]);

    expect(
      await asAppRole(db, (tx) =>
        setStartingPassword(admin, { memberId: created.memberId, password: "short" }, tx),
      ),
    ).toEqual({ ok: false, reason: "passwordTooShort" });
  });
});

describe("refusals", () => {
  it("refuses every staff service to anyone without the admin role, and changes nothing", async () => {
    const created = await newMember(["receptionist", "practitioner"]);
    const nonAdmin: Actor = {
      organizationId: admin.organizationId,
      userId: created.userId,
      roles: ["receptionist", "practitioner"],
    };
    const memberId = created.memberId;

    const results = await asAppRole(db, async (tx) => [
      await listStaff(nonAdmin, tx),
      await getStaffMember(nonAdmin, { memberId }, tx),
      await createStaffMember(
        nonAdmin,
        { name: "X", email: "x@example.com", password: startingPassword, roles: ["admin"] },
        tx,
      ),
      await changeRoles(nonAdmin, { memberId, roles: ["admin"] }, tx),
      await updatePractitioner(
        nonAdmin,
        { memberId, displayName: "X", specialty: "", keepsClinicalRecords: false },
        tx,
      ),
      await setMemberActive(nonAdmin, { memberId: adminMemberId, active: false }, tx),
      await setStartingPassword(nonAdmin, { memberId: adminMemberId, password: "x-password" }, tx),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
    const staff = await asAppRole(db, (tx) => listStaff(admin, tx));
    expect(staff).toMatchObject({
      ok: true,
      staff: [
        { memberId: adminMemberId, active: true },
        {
          memberId,
          roles: ["receptionist", "practitioner"],
          practitioner: { displayName: "Juan Gómez" },
        },
      ],
    });
  });

  it("answers notFound for a member of another organization", async () => {
    const other = await createOrganization(auth, "Consultorios Palermo");
    const otherAdmin: Actor = {
      organizationId: other.organizationId,
      userId: other.adminUserId,
      roles: ["admin"],
    };
    const created = await newMember(["practitioner"]);

    const results = await asAppRole(db, async (tx) => [
      await getStaffMember(otherAdmin, { memberId: created.memberId }, tx),
      await changeRoles(otherAdmin, { memberId: created.memberId, roles: ["admin"] }, tx),
      await setMemberActive(otherAdmin, { memberId: created.memberId, active: false }, tx),
      await setStartingPassword(
        otherAdmin,
        { memberId: created.memberId, password: "x-password" },
        tx,
      ),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "notFound" });
    }
    const staff = await asAppRole(db, (tx) => listStaff(otherAdmin, tx));
    expect(staff.ok && staff.staff.map((member) => member.email)).toEqual([
      "ana@consultorios-palermo.example.com",
    ]);
  });
});
