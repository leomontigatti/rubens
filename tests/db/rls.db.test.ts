import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { member, office, practitioner, room, user } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";

import { asAppRole, createTestDatabase, rowsOf } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

// ADR-0002: row-level security is the tenant boundary. Each tenant table gets
// rows for two organizations; the app role, under one organization's settings,
// reaches only that organization's rows.

let client: PGlite;
let db: TestDatabase;

const actorA: Actor = { organizationId: "org-a", userId: "user-a", roles: ["admin"] };
const actorB: Actor = { organizationId: "org-b", userId: "user-b", roles: ["admin"] };

// Better Auth's tables carry `organization_id` but are not tenant-owned: Better
// Auth reads them before any tenant is known (PRD #16).
const betterAuthTables = ["member", "invitation"];

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  // As the owner, which bypasses row-level security.
  await db.execute(sql`
    insert into rubens.organization (id, name, slug, created_at) values
      ('org-a', 'A', 'a', now()),
      ('org-b', 'B', 'b', now())
  `);
  for (const organizationId of ["org-a", "org-b"]) {
    const [created] = await db
      .insert(office)
      .values({ organizationId, name: `Sede ${organizationId}`, address: "Calle 1" })
      .returning();
    await db.insert(room).values({ organizationId, officeId: created!.id, name: "Consultorio 1" });
    const userId = `user-${organizationId}`;
    await db.insert(user).values({ id: userId, name: "Juan", email: `${userId}@example.com` });
    await db.insert(member).values({
      id: `member-${organizationId}`,
      organizationId,
      userId,
      role: "practitioner",
      createdAt: new Date(),
    });
    await db
      .insert(practitioner)
      .values({ organizationId, memberId: `member-${organizationId}`, displayName: "Juan" });
  }
});

afterEach(async () => {
  await client.close();
});

async function officeOf(organizationId: string) {
  const rows = await db.select().from(office);
  return rows.find((row) => row.organizationId === organizationId)!;
}

describe("row-level security on tenant tables", () => {
  it("shows the app role only its own organization's offices and rooms", async () => {
    const seen = await asAppRole(db, (tx) =>
      withTenant(
        actorA,
        async (tenant) => ({
          offices: await tenant.select().from(office),
          rooms: await tenant.select().from(room),
          practitioners: await tenant.select().from(practitioner),
        }),
        tx,
      ),
    );

    expect(seen.offices.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.rooms.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.practitioners.map((row) => row.organizationId)).toEqual(["org-a"]);
  });

  it("shows nothing to the app role without a tenant setting", async () => {
    const counts = await asAppRole(db, async (tx) =>
      rowsOf<{ offices: number; rooms: number; practitioners: number }>(
        await tx.execute(sql`
          select
            (select count(*)::int from rubens.office) as offices,
            (select count(*)::int from rubens.room) as rooms,
            (select count(*)::int from rubens.practitioner) as practitioners
        `),
      ),
    );

    expect(counts[0]).toEqual({ offices: 0, rooms: 0, practitioners: 0 });
  });

  it("leaves another organization's rows unchanged by updates and deletes", async () => {
    await asAppRole(db, (tx) =>
      withTenant(
        actorA,
        async (tenant) => {
          await tenant.update(office).set({ name: "Cambiada" });
          await tenant.update(room).set({ name: "Cambiado" });
          await tenant.delete(room);
          await tenant.update(practitioner).set({ displayName: "Cambiado" });
          await tenant.delete(practitioner);
        },
        tx,
      ),
    );

    const officeB = await officeOf("org-b");
    const roomsB = (await db.select().from(room)).filter((row) => row.organizationId === "org-b");
    const practitionersB = (await db.select().from(practitioner)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(officeB.name).toBe("Sede org-b");
    expect(roomsB.map((row) => row.name)).toEqual(["Consultorio 1"]);
    expect(practitionersB.map((row) => row.displayName)).toEqual(["Juan"]);
  });

  it("refuses to write a row into another organization", async () => {
    const officeB = await officeOf("org-b");

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(office).values({ organizationId: "org-b", name: "X", address: "Y" }),
          tx,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorB,
          (tenant) =>
            tenant
              .update(office)
              .set({ organizationId: "org-a" })
              .where(sql`id = ${officeB.id}`),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a room in another organization's office", async () => {
    const officeB = await officeOf("org-b");

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant
              .insert(room)
              .values({ organizationId: "org-a", officeId: officeB.id, name: "Intruso" }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a practitioner for another organization's member", async () => {
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(practitioner).values({
              organizationId: "org-a",
              memberId: "member-org-b",
              displayName: "Intruso",
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("the row-level security guard", () => {
  it("finds RLS enabled, forced and with a policy on every rubens table with an organization column", async () => {
    const tables = rowsOf<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(
      await db.execute(sql`
        select
          c.relname as table_name,
          c.relrowsecurity as enabled,
          c.relforcerowsecurity as forced,
          (select count(*)::int from pg_policies p
            where p.schemaname = 'rubens' and p.tablename = c.relname) as policies
        from information_schema.columns col
        join pg_class c on c.relname = col.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = col.table_schema
        where col.table_schema = 'rubens' and col.column_name = 'organization_id'
      `),
    );
    const tenantTables = tables.filter((table) => !betterAuthTables.includes(table.table_name));

    expect(tenantTables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining(["office", "room", "practitioner"]),
    );
    expect(
      tenantTables.filter((table) => !table.enabled || !table.forced || table.policies === 0),
    ).toEqual([]);
  });
});
