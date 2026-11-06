import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeAccounts } from "#/organization/organization.test-support.ts";
import { handleSetupRequest } from "#/server/organization-setup.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { organizationObject } from "#/server/caller.ts";

vi.mock(import("#/organization/accounts.ts"), async (original) => ({
  ...(await original()),
  accountsFor: () => fakeAccounts,
}));

const bindings = { ...(env as unknown as WorkerEnv), SETUP_SECRET: "the-setup-secret" };

function setupRequest(organizationName: string, authorization = "Bearer the-setup-secret") {
  return new Request("https://rubens.test/api/setup", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      organizationName,
      adminName: "Ana Gómez",
      adminEmail: "ana@example.com",
      password: "starting-password",
    }),
  });
}

beforeEach(() => fakeAccounts.reset());

describe("the setup endpoint", () => {
  it("sets the organization up in the object its name's slug names", async () => {
    const name = `Consultorios Belgrano ${crypto.randomUUID()}`;

    const response = await handleSetupRequest(setupRequest(name), bindings);

    const organizationId = name.toLowerCase().replaceAll(" ", "-");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      organizationId,
      userId: fakeAccounts.lastUserId,
    });
    expect(
      await organizationObject(bindings, organizationId).viewer({
        userId: fakeAccounts.lastUserId!,
      }),
    ).toMatchObject({ ok: true, viewer: { organizationName: name, roles: ["admin"] } });
  });

  it("refuses a request without the setup secret, and creates no user", async () => {
    const responses = [
      await handleSetupRequest(setupRequest("Otra", "Bearer wrong"), bindings),
      await handleSetupRequest(setupRequest("Otra", ""), bindings),
      await handleSetupRequest(setupRequest("Otra"), { ...bindings, SETUP_SECRET: undefined }),
    ];

    expect(responses.map((response) => response.status)).toEqual([401, 401, 404]);
    expect(fakeAccounts.calls).toEqual([]);
  });

  it("refuses a name with no letters or digits for its slug", async () => {
    const response = await handleSetupRequest(setupRequest("¡¡!!"), bindings);

    expect(await response.json()).toEqual({ ok: false, reason: "invalidOrganizationName" });
    expect(fakeAccounts.calls).toEqual([]);
  });
});
