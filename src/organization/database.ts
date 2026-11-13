import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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

/**
 * Opens the object's storage. `onTransaction`, when given, is told of every
 * transaction opened: the only way an area writes (`docs/agents/coding-standards.md`),
 * so the runtime knows which calls wrote.
 */
export function openDatabase(storage: DurableObjectStorage, onTransaction?: () => void): Database {
  const database = drizzle(storage, { schema });
  if (onTransaction) {
    const transaction = database.transaction.bind(database);
    database.transaction = (work, config) => {
      onTransaction();
      return transaction(work, config);
    };
  }
  return database;
}

/**
 * `values`, a list held in memory (a turn's messages, a webhook's statuses), as
 * a subquery for an `inArray` that binds one parameter however long it is: the
 * object's SQLite binds at most 100 a query. Where a query alone reads the list,
 * the `inArray` takes that query instead (`patientsReachedAt`).
 */
export function boundAsOne(values: string[]): SQL {
  return sql`(select value from json_each(${JSON.stringify(values)}))`;
}

/** Applies every migration the object has not run yet. */
export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database, migrations);
}
