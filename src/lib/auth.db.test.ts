import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { member } from "#/db/schema/index.ts";

import { createAuth, handleAuthRequest } from "#/lib/auth.ts";
import type { Auth } from "#/lib/auth.ts";
import { createMember, createOrganization, startingPassword } from "#/test-support/organization.ts";

import { sharedTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";

const testDatabase = sharedTestDatabase();
let db: TestDatabase;
let auth: Auth;
let organizationId: string;
let cookie: string;

beforeEach(async () => {
  db = await testDatabase.reset();
  auth = createAuth(db);
  ({ organizationId } = await createOrganization(auth));
  const signIn = await auth.api.signInEmail({
    body: { email: "ana@consultorios-belgrano.example.com", password: startingPassword },
    returnHeaders: true,
  });
  cookie = signIn.headers.get("set-cookie") ?? "";
});

function request(path: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("handleAuthRequest", () => {
  it("serves the core endpoints to a signed-in user", async () => {
    const response = await handleAuthRequest(auth, request("/get-session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session: { activeOrganizationId: organizationId },
    });
  });

  // An admin is the plugin's creator role, so its member endpoints would let
  // one skip the staff services' rules.
  it("refuses the organization plugin's endpoints, even to an admin", async () => {
    const userId = await createMember(auth, organizationId, ["receptionist"]);
    const receptionist = await db.query.member.findFirst({ where: eq(member.userId, userId) });

    const memberRole = await handleAuthRequest(
      auth,
      request("/organization/update-member-role", {
        memberId: receptionist!.id,
        role: ["admin"],
      }),
    );
    const members = await handleAuthRequest(
      auth,
      request(`/organization/list-members?organizationId=${organizationId}`),
    );

    expect(memberRole.status).toBe(404);
    expect(members.status).toBe(404);
    const after = await db.query.member.findFirst({ where: eq(member.userId, userId) });
    expect(after!.role).toBe("receptionist");
  });
});
