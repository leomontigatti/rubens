import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.ts";

export type Schema = typeof schema;
type Database = NodePgDatabase<Schema> & { $client: Pool };

// The pool lives on `globalThis`, not in a module variable: the dev server
// re-evaluates this module on every edit, and a module variable would open a new
// pool each time and never close the old one.
const globalForPool = globalThis as typeof globalThis & { __rubensDbPool?: Pool };

let dbInstance: Database | undefined;

// `DATABASE_URL` connects as `rubens_app`, the role RLS applies to; a pooler,
// if one is ever added, fronts this URL (ADR-0002). Migrations and pg-boss use
// `DATABASE_DIRECT_URL` instead.
function getPool(): Pool {
  if (!globalForPool.__rubensDbPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    globalForPool.__rubensDbPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10_000,
    });
  }
  return globalForPool.__rubensDbPool;
}

function getDb(): Database {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

// Lazy: importing `#/db/client.ts` neither validates `DATABASE_URL` nor opens a
// connection, so a build or a unit test that reaches it transitively needs no
// database.
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
