import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createAuth } from "#/lib/auth.ts";
import type { Auth } from "#/lib/auth.ts";

import { createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { setupOrganization } from "#/server/setup.ts";

let client: PGlite;
let db: TestDatabase;
let auth: Auth;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  auth = createAuth(db);
});

afterEach(async () => {
  await client.close();
});

const input = {
  organizationName: "Consultorios Belgrano",
  adminName: "Ana Pérez",
  adminEmail: "ana@example.com",
  password: "starting-password",
};

describe("setupOrganization", () => {
  it("creates the organization with its first admin, who must change the password", async () => {
    const result = await setupOrganization(auth, input);

    expect(result).toMatchObject({ ok: true });
    const member = await db.query.member.findFirst({ with: { organization: true, user: true } });
    expect(member).toMatchObject({
      role: "admin",
      organization: { name: "Consultorios Belgrano", slug: "consultorios-belgrano" },
      user: { name: "Ana Pérez", email: "ana@example.com", mustChangePassword: true },
    });
  });

  it("lets the admin sign in with the starting password, into the organization", async () => {
    await setupOrganization(auth, input);

    const signIn = await auth.api.signInEmail({
      body: { email: input.adminEmail, password: input.password },
      returnHeaders: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    const organization = await db.query.organization.findFirst();
    expect(session?.session.activeOrganizationId).toBe(organization?.id);
  });

  it("changes nothing when the organization already exists", async () => {
    await setupOrganization(auth, input);

    const second = await setupOrganization(auth, {
      ...input,
      adminName: "Otra Persona",
      adminEmail: "otra@example.com",
    });

    expect(second).toEqual({ ok: false, reason: "organizationExists" });
    expect(await db.query.organization.findMany()).toHaveLength(1);
    expect(await db.query.user.findMany()).toHaveLength(1);
  });

  it("refuses a name with no letters or digits for its slug, writing nothing", async () => {
    const result = await setupOrganization(auth, { ...input, organizationName: "---" });

    expect(result).toEqual({ ok: false, reason: "invalidOrganizationName" });
    expect(await db.query.user.findMany()).toHaveLength(0);
  });
});
