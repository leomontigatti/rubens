import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { TENANT_SETTING, withTenant } from "#/db/tenant.ts";

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

// The same name RLS policies read: `current_setting('app.organization_id', true)`.
const tenantQuery = sql`select current_setting(${TENANT_SETTING}, true) as tenant`;

describe("withTenant", () => {
  it("sets app.organization_id inside the transaction", async () => {
    const seen = await withTenant(
      "org-a",
      async (tx) => rowsOf<{ tenant: string | null }>(await tx.execute(tenantQuery))[0]?.tenant,
      db,
    );

    expect(seen).toBe("org-a");
  });

  it("clears the setting when the transaction ends", async () => {
    await withTenant("org-a", async () => undefined, db);

    const after = rowsOf<{ tenant: string | null }>(await db.execute(tenantQuery));

    // An unset custom setting reads as NULL or as an empty string, depending on
    // whether the session ever set it; either way it names no organization.
    expect(after[0]?.tenant ?? "").toBe("");
  });

  it("clears the setting when the transaction rolls back", async () => {
    await expect(
      withTenant(
        "org-a",
        async () => {
          throw new Error("boom");
        },
        db,
      ),
    ).rejects.toThrow("boom");

    const after = rowsOf<{ tenant: string | null }>(await db.execute(tenantQuery));
    expect(after[0]?.tenant ?? "").toBe("");
  });
});
