import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "./client.ts";
import type { Schema } from "./client.ts";

// Any drizzle Postgres database: the node-postgres one the app uses, or the
// PGlite one the DB tests use (tests/db/harness.ts). The tenant rule is the same
// for both, so the helper takes the common type rather than one driver's.
export type AnyDatabase = PgDatabase<PgQueryResultHKT, Schema>;

export type Transaction = Parameters<Parameters<AnyDatabase["transaction"]>[0]>[0];

/** The setting RLS policies read: `current_setting('app.organization_id', true)`. */
export const TENANT_SETTING = "app.organization_id";

/**
 * Runs `work` in a transaction scoped to one organization. Every query that
 * touches tenant-owned tables goes through here.
 *
 * The third argument of `set_config` is `is_local = true`: the setting dies with
 * the transaction, exactly like `SET LOCAL`. Never replace it with a plain
 * `SET`: on a pooled connection it would outlive the request and the next
 * request, possibly another organization's, would run under it (ADR-0002).
 */
export async function withTenant<T>(
  organizationId: string,
  work: (tx: Transaction) => Promise<T>,
  database: AnyDatabase = db,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${organizationId}, true)`);
    return work(tx);
  });
}
