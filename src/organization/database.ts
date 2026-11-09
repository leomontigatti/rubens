import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "#/organization/migrations/migrations.js";
import * as coreSchema from "#/organization/schema.ts";
import * as whatsappSchema from "#/organization/whatsapp-schema.ts";

const schema = { ...coreSchema, ...whatsappSchema };

/**
 * The organization object's storage, through Drizzle. On this driver queries
 * and transactions are synchronous: a check and the write it guards run with
 * no `await` between them, so no other call can interleave (ADR-0008).
 */
export type Database = DrizzleSqliteDODatabase<typeof schema>;

/** A transaction, or the database itself: what a write that must commit with others takes. */
export type Writer = Parameters<Parameters<Database["transaction"]>[0]>[0] | Database;

export function openDatabase(storage: DurableObjectStorage): Database {
  return drizzle(storage, { schema });
}

/** Applies every migration the object has not run yet. */
export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database, migrations);
}
