import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/lib/access.ts";
import { TENANT_SETTINGS, withTenant } from "#/db/tenant.ts";

import { createTestDatabase, rowsOf } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

// ADR-0002: the tenant is set per transaction, never per session. These pin the
// rule that keeps a connection pooler a configuration change.

let client: PGlite;
let db: TestDatabase;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
});

afterEach(async () => {
  await client.close();
});

const actor: Actor = {
  organizationId: "org-a",
  userId: "user-a",
  roles: ["admin", "practitioner"],
};

interface Settings {
  organization_id: string | null;
  user_id: string | null;
  roles: string | null;
}

// The same names RLS policies read: `current_setting('app.organization_id', true)`.
const settingsQuery = sql`
  select
    current_setting(${TENANT_SETTINGS.organizationId}, true) as organization_id,
    current_setting(${TENANT_SETTINGS.userId}, true) as user_id,
    current_setting(${TENANT_SETTINGS.roles}, true) as roles
`;

// An unset custom setting reads as NULL or as an empty string, depending on
// whether the session ever set it; either way it names nobody.
function expectCleared(settings: Settings | undefined) {
  expect(settings?.organization_id ?? "").toBe("");
  expect(settings?.user_id ?? "").toBe("");
  expect(settings?.roles ?? "").toBe("");
}

describe("withTenant", () => {
  it("exposes the actor's organization, user and roles inside the transaction", async () => {
    const seen = await withTenant(
      actor,
      async (tx) => rowsOf<Settings>(await tx.execute(settingsQuery))[0],
      db,
    );

    expect(seen).toEqual({
      organization_id: "org-a",
      user_id: "user-a",
      roles: "admin,practitioner",
    });
  });

  it("clears the settings when the transaction ends", async () => {
    await withTenant(actor, async () => undefined, db);

    expectCleared(rowsOf<Settings>(await db.execute(settingsQuery))[0]);
  });

  it("clears the settings when the transaction rolls back", async () => {
    await expect(
      withTenant(
        actor,
        async () => {
          throw new Error("boom");
        },
        db,
      ),
    ).rejects.toThrow("boom");

    expectCleared(rowsOf<Settings>(await db.execute(settingsQuery))[0]);
  });
});
