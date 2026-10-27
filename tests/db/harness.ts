import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { inject } from "vite-plus/test";

import * as schema from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";

import { migratedDataDirKey } from "./global-setup.ts";

export type TestDatabase = PgliteDatabase<typeof schema>;

let migratedDataDir: Promise<Blob> | undefined;

/**
 * A fresh in-process Postgres (PGlite) with every migration applied, loaded
 * from the data directory `global-setup.ts` migrated once for the whole run.
 * Each call is its own database, so tests and files stay isolated.
 *
 * `btree_gist` is loaded as a contrib extension because migration 0000 creates
 * it, and PGlite only has the extensions it is handed.
 */
export async function createTestDatabase(): Promise<{
  client: PGlite;
  db: TestDatabase;
}> {
  migratedDataDir ??= readFile(inject(migratedDataDirKey) as string).then(
    (bytes) => new Blob([bytes]),
  );
  const client = await PGlite.create({
    loadDataDir: await migratedDataDir,
    extensions: { btree_gist },
  });
  const db = drizzle(client, { schema });

  return { client, db };
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
