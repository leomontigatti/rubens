import { beforeEach, describe, expect, it } from "vite-plus/test";

import { createAuth } from "#/lib/auth.ts";
import type { Auth } from "#/lib/auth.ts";
import { createOrganization, startingPassword } from "#/test-support/organization.ts";

import { sharedTestDatabase } from "../../tests/db/harness.ts";
import { changeOwnPassword } from "#/server/accounts.ts";
import { authorize } from "#/server/actor.ts";

const testDatabase = sharedTestDatabase();
let auth: Auth;
let userId: string;

beforeEach(async () => {
  auth = createAuth(await testDatabase.reset());
  ({ adminUserId: userId } = await createOrganization(auth));
});

describe("changeOwnPassword", () => {
  it("replaces the starting password and lifts the gate", async () => {
    const result = await changeOwnPassword(auth, userId, {
      currentPassword: startingPassword,
      newPassword: "a-password-of-my-own",
    });

    expect(result).toEqual({ ok: true });
    expect(await authorize(auth, userId, { roles: "any" })).toMatchObject({ ok: true });
    const user = await auth.api.signInEmail({
      body: { email: "ana@consultorios-belgrano.example.com", password: "a-password-of-my-own" },
    });
    expect(user.user.id).toBe(userId);
  });

  it("refuses a wrong current password and keeps the gate", async () => {
    const result = await changeOwnPassword(auth, userId, {
      currentPassword: "not-the-password",
      newPassword: "a-password-of-my-own",
    });

    expect(result).toEqual({ ok: false, reason: "wrongPassword" });
    expect(await authorize(auth, userId, { roles: "any" })).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
  });

  it("refuses to keep the starting password", async () => {
    const result = await changeOwnPassword(auth, userId, {
      currentPassword: startingPassword,
      newPassword: startingPassword,
    });

    expect(result).toEqual({ ok: false, reason: "samePassword" });
  });
});
