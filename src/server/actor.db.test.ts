import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createAuth } from "#/lib/auth.ts";
import type { Auth } from "#/lib/auth.ts";
import {
  clearMustChangePassword,
  createMember,
  createOrganization,
} from "#/test-support/organization.ts";

import { createTestDatabase } from "../../tests/db/harness.ts";
import { authorize } from "./actor.ts";

let client: PGlite;
let auth: Auth;
let organizationId: string;

beforeEach(async () => {
  const database = await createTestDatabase();
  client = database.client;
  auth = createAuth(database.db);
  ({ organizationId } = await createOrganization(auth));
});

afterEach(async () => {
  await client.close();
});

describe("authorize", () => {
  it("refuses a call without a signed-in user", async () => {
    expect(await authorize(auth, undefined, { roles: "any" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("resolves a member holding several roles, and accepts any one of them", async () => {
    const userId = await createMember(auth, organizationId, ["receptionist", "practitioner"]);
    await clearMustChangePassword(auth, userId);

    const result = await authorize(auth, userId, { roles: ["practitioner"] });

    expect(result).toEqual({
      ok: true,
      actor: { organizationId, userId, roles: ["receptionist", "practitioner"] },
    });
  });

  it("refuses a member without the required role", async () => {
    const userId = await createMember(auth, organizationId, ["receptionist"]);
    await clearMustChangePassword(auth, userId);

    expect(await authorize(auth, userId, { roles: ["admin"] })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses a member who must still change the starting password, except to change it", async () => {
    const userId = await createMember(auth, organizationId, ["admin"]);

    expect(await authorize(auth, userId, { roles: "any" })).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    expect(
      await authorize(auth, userId, { roles: "any", passwordChange: "allowed" }),
    ).toMatchObject({ ok: true });
  });
});
