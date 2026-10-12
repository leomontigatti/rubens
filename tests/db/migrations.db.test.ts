import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { asAppRole, createTestDatabase, rowsOf } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

let client: PGlite;
let db: TestDatabase;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
});

afterEach(async () => {
  await client.close();
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

  it("create the app role and the btree_gist extension", async () => {
    const role = rowsOf(
      await db.execute(sql`
        select rolname from pg_roles where rolname = 'rubens_app'
      `),
    );
    const extension = rowsOf(
      await db.execute(sql`
        select extname from pg_extension where extname = 'btree_gist'
      `),
    );

    expect(role).toHaveLength(1);
    expect(extension).toHaveLength(1);
  });
});
