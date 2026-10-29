import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { auditLog } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";

import { asAppRole, sharedTestDatabase } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

// ADR-0003: the audit log is append-only for the app. The app role inserts and
// reads entries; an UPDATE or DELETE fails on privileges, whatever the tenant.

const testDatabase = sharedTestDatabase();
let db: TestDatabase;

const actor: Actor = { organizationId: "org-a", userId: "user-a", roles: ["admin"] };

beforeEach(async () => {
  db = await testDatabase.reset();
  await db.execute(sql`
    insert into rubens.organization (id, name, slug, created_at) values ('org-a', 'A', 'a', now())
  `);
  await asAppRole(db, (tx) =>
    withTenant(
      actor,
      (tenant) =>
        tenant.insert(auditLog).values({
          organizationId: "org-a",
          userId: "user-a",
          action: "create",
          entityType: "patient",
          entityId: "00000000-0000-4000-8000-000000000001",
          after: { firstName: "Juan" },
        }),
      tx,
    ),
  );
});

const asTenant = (work: Parameters<typeof withTenant>[1]) =>
  asAppRole(db, (tx) => withTenant(actor, work, tx));

// Drizzle wraps the driver's error; Postgres's own message is its cause.
const permissionDenied = { cause: { message: expect.stringMatching(/permission denied/) } };

describe("the audit log", () => {
  it("lets the app role read the entries it wrote", async () => {
    const entries = await asTenant((tenant) => tenant.select().from(auditLog));

    expect(entries).toMatchObject([{ action: "create", after: { firstName: "Juan" } }]);
  });

  it("refuses the app role an update", async () => {
    await expect(
      asTenant((tenant) => tenant.update(auditLog).set({ action: "update" })),
    ).rejects.toMatchObject(permissionDenied);
  });

  it("refuses the app role a delete", async () => {
    await expect(asTenant((tenant) => tenant.delete(auditLog))).rejects.toMatchObject(
      permissionDenied,
    );
  });
});
