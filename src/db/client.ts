import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.ts";

export type Schema = typeof schema;
type Database = NodePgDatabase<Schema>;

let poolInstance: Pool | undefined;
let dbInstance: Database | undefined;

// `DATABASE_URL` connects as `rubens_app`, the role RLS applies to; a pooler,
// if one is ever added, fronts this URL (ADR-0002). Migrations and pg-boss use
// `DATABASE_DIRECT_URL` instead.
function getPool(): Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    poolInstance = new Pool({ connectionString, max: 10 });
  }
  return poolInstance;
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
