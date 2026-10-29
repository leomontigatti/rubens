import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { asAppRole, sharedTestDatabase, rowsOf } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

const testDatabase = sharedTestDatabase();
let db: TestDatabase;

beforeEach(async () => {
  db = await testDatabase.reset();
});

describe("migrations on PGlite", () => {
  it("put every app table in the rubens schema and none in public", async () => {
    const rows = rowsOf<{ table_schema: string; table_name: string }>(
      await db.execute(sql`
        select table_schema, table_name
        from information_schema.tables
        where table_schema in ('rubens', 'public')
      `),
    );

    const inRubens = rows
      .filter((row) => row.table_schema === "rubens")
      .map((row) => row.table_name);
    const inPublic = rows
      .filter((row) => row.table_schema === "public")
      .map((row) => row.table_name);

    // ADR-0004: `public` is for extensions only, so a table that lands there was
    // declared with `pgTable` instead of `rubens.table`.
    expect(inRubens).toEqual(
      expect.arrayContaining(["user", "session", "account", "organization"]),
    );
    expect(inPublic).toEqual([]);
  });

  it("let the app role read and write the app tables", async () => {
    const count = await asAppRole(db, async (tx) =>
      rowsOf<{ count: number }>(
        await tx.execute(sql`select count(*)::int as count from rubens.user`),
      ),
    );

    expect(count[0]?.count).toBe(0);
  });

  it("create the app role and the extensions in public", async () => {
    const role = rowsOf(
      await db.execute(sql`
        select rolname from pg_roles where rolname = 'rubens_app'
      `),
    );
    const extension = rowsOf(
      await db.execute(sql`
        select e.extname, n.nspname as schema
        from pg_catalog.pg_extension e
        join pg_catalog.pg_namespace n on n.oid = e.extnamespace
        where e.extname in ('btree_gist', 'unaccent', 'pg_trgm')
        order by e.extname
      `),
    );

    expect(role).toHaveLength(1);
    expect(extension).toEqual([
      { extname: "btree_gist", schema: "public" },
      { extname: "pg_trgm", schema: "public" },
      { extname: "unaccent", schema: "public" },
    ]);
  });
});
