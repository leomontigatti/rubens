import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, inject } from "vite-plus/test";

import * as schema from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";

import { testExtensions } from "./extensions.ts";
import { migratedDataDirKey } from "./global-setup.ts";

export type TestDatabase = PgliteDatabase<typeof schema>;

/**
 * A fresh in-process Postgres (PGlite) with every migration applied, loaded
 * from the data directory `global-setup.ts` migrated once for the whole run.
 * Each call is its own database, so tests and files stay isolated.
 *
 * `btree_gist`, `unaccent` and `pg_trgm` are loaded as contrib extensions
 * because the migrations create them (0001, 0008), and PGlite only has the
 * extensions it is handed.
 */
export async function createTestDatabase(): Promise<{
  client: PGlite;
  db: TestDatabase;
}> {
  // Read on every boot, not cached in the module: modules outlive a watch-mode
  // rerun (`isolate: false`), and global-setup rewrites the file when a
  // migration changes.
  const migratedDataDir = new Blob([await readFile(inject(migratedDataDirKey) as string)]);
  const client = await PGlite.create({
    loadDataDir: migratedDataDir,
    extensions: testExtensions,
  });
  const db = drizzle(client, { schema });

  return { client, db };
}

/**
 * One database for the whole test file, emptied by each `reset()`: call it in
 * `beforeEach`, and the file's last test closes it. A boot costs several times
 * what emptying does, so a file of many tests boots once instead of per test.
 *
 * `reset()` truncates every table in the `rubens` schema, which is where every
 * row a test writes lands (ADR-0004; no migration seeds one), and discards the
 * session state a test could leave on the connection, such as a non-local
 * `set_config`. The migrations' roles, schema and extensions stay as loaded.
 */
export function sharedTestDatabase(): { reset: () => Promise<TestDatabase> } {
  let opened: Promise<{ client: PGlite; db: TestDatabase; truncate: string }> | undefined;

  afterAll(async () => {
    await (await opened)?.client.close();
  });

  return {
    async reset() {
      if (!opened) {
        opened = createTestDatabase().then(async ({ client, db }) => {
          const { rows } = await client.query<{ name: string }>(
            "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'rubens'",
          );
          const truncate = `truncate ${rows.map((row) => row.name).join(", ")} restart identity cascade`;
          return { client, db, truncate };
        });
        return (await opened).db;
      }
      const { client, db, truncate } = await opened;
      // Separate calls: DISCARD ALL cannot run inside a transaction block.
      await client.query("discard all");
      await client.query(truncate);
      return db;
    },
  };
}

/**
 * The rows of a raw `execute` result. The result is typed `unknown` through the
 * common transaction type, so the test names the row shape here instead.
 */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/**
 * Runs `work` inside a transaction as the app role `rubens_app`, the role RLS
 * applies to (ADR-0002). `SET LOCAL ROLE` ends with the transaction, so the
 * session is back to the owner role afterwards and nothing leaks into the next
 * call.
 */
export async function asAppRole<T>(
  database: TestDatabase,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`set local role rubens_app`);
    return work(tx);
  });
}
