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

describe("asAppRole", () => {
  it("runs the callback as rubens_app, the role RLS applies to", async () => {
    const role = await asAppRole(db, async (tx) => {
      const rows = rowsOf<{ role: string }>(await tx.execute(sql`select current_user as role`));
      return rows[0]?.role;
    });

    expect(role).toBe("rubens_app");
  });

  it("returns to the owner role once the transaction ends", async () => {
    await asAppRole(db, async () => undefined);

    const rows = rowsOf<{ role: string }>(await db.execute(sql`select current_user as role`));
    expect(rows[0]?.role).not.toBe("rubens_app");
  });
});

describe("createTestDatabase", () => {
  it("gives each caller its own database, so one test's rows never reach another", async () => {
    await db.execute(sql`insert into rubens.organization (id, name, slug, created_at)
      values ('org-a', 'A', 'a', now())`);

    const other = await createTestDatabase();
    const rows = rowsOf<{ count: number }>(
      await other.db.execute(sql`select count(*)::int as count from rubens.organization`),
    );
    await other.client.close();

    expect(rows[0]?.count).toBe(0);
  });
});
