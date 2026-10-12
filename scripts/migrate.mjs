import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { findJournalInconsistencies, readHashedJournalEntries } from "./migrations/journal.mjs";

/**
 * Applies pending migrations, then exits. Run by the container entrypoint
 * before the app serves, because the production Postgres is not reachable from
 * outside the VPS and `pnpm db:migrate` has no route to it.
 *
 * Migrations connect as the owner role through `DATABASE_DIRECT_URL` (ADR-0002):
 * RLS does not apply to a table's owner, and the advisory lock below needs a
 * session that a transaction pooler would not keep. `DATABASE_URL` is only the
 * fallback when no direct URL is set.
 *
 * Written in plain `.mjs` on purpose: `tsx` and `drizzle-kit` are
 * devDependencies and are stripped from the runtime image by `pnpm prune`,
 * while `drizzle-orm` and `pg` are production dependencies.
 */

// Resolved relative to this file so the same expression works in the repo and
// in the image, where `src/db/migrations` is copied to the identical path.
const migrationsFolder = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

const migrationLockName = "rubens-migrations";
const connectRetryBudgetMs = 45_000;
const initialRetryDelayMs = 500;
const maxRetryDelayMs = 5_000;
const advisoryLockTimeoutMs = 60_000;
const tableLockTimeout = "5s";

// The app and Postgres are co-located containers with no start ordering, so a
// refused connection right after a host reboot is expected rather than
// exceptional. Anything outside this set (bad credentials, missing database,
// failing DDL) is deterministic and must not be retried.
const transientConnectionCodes = new Set([
  // Node socket errors.
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  // Postgres SQLSTATEs: connection exception class, and admin shutdown / crash
  // / cannot connect now.
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

/** @param {unknown} error */
function isTransientConnectionError(error) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = /** @type {{ code?: unknown }} */ (error).code;

  if (typeof code === "string" && transientConnectionCodes.has(code)) {
    return true;
  }

  // node-postgres reports a dropped or timed-out connection with no code, only
  // a message.
  const message = /** @type {{ message?: unknown }} */ (error).message;

  return typeof message === "string" && /Connection terminated/.test(message);
}

/** @param {number} milliseconds */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Connects, retrying only until the database answers. Once it has, every later
 * failure is treated as fatal, which keeps the two error classes cleanly
 * separated: a database that is still booting is waited out, a migration that
 * cannot apply stops the container.
 *
 * Returns the connected client, because a failed connect leaves a client
 * unusable and a retry needs a fresh one.
 *
 * @param {string} connectionString
 * @returns {Promise<pg.Client>}
 */
async function connectWithRetry(connectionString) {
  const deadline = Date.now() + connectRetryBudgetMs;
  let delay = initialRetryDelayMs;

  for (;;) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => undefined);

      if (!isTransientConnectionError(error) || Date.now() >= deadline) {
        throw error;
      }

      console.log(`[migrate] database not reachable yet, retrying in ${delay}ms.`);
      await wait(delay);
      delay = Math.min(delay * 2, maxRetryDelayMs);
    }
  }
}

/**
 * Blocking, not `pg_try_advisory_lock`: a second starter should wait and then
 * correctly no-op, not fail to boot. Consequence 3 in scripts/migrations/journal.mjs
 * is what makes the lock necessary: without it two overlapping container starts
 * act on the same stale watermark and the second re-runs committed DDL.
 *
 * The timeout bounds the wait for the advisory lock only. It is restored
 * afterwards rather than zeroed, so whatever `statement_timeout` the role
 * carries still governs the migrations themselves; the table locks the DDL
 * itself takes are bounded separately, by `withMigrationLockTimeout`.
 *
 * @param {pg.Client} client
 */
async function acquireMigrationLock(client) {
  const previous = await client.query(
    "select current_setting('statement_timeout') as statement_timeout",
  );
  const previousStatementTimeout = String(previous.rows[0]?.statement_timeout ?? "0");

  await client.query("select set_config('statement_timeout', $1, false)", [
    String(advisoryLockTimeoutMs),
  ]);

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [migrationLockName]);
  } finally {
    await client.query("select set_config('statement_timeout', $1, false)", [
      previousStatementTimeout,
    ]);
  }
}

/**
 * Bounds how long the migration DDL waits for a *table* lock. Without it an
 * `ALTER TABLE` blocked behind a long-running query waits forever, and every
 * query that arrives afterwards queues behind the lock request it is holding:
 * the whole table stops answering while nothing visibly fails.
 *
 * Session level, which a single client makes exactly the migrator's connection,
 * and restored afterwards like the advisory lock's `statement_timeout`.
 *
 * Failure mode when the timeout fires: the statement errors, Drizzle's
 * transaction rolls back and this script exits non-zero, so the container does
 * not start. The old container keeps serving and a redeploy retries: a deploy
 * that waits rather than a schema half-applied.
 *
 * @param {pg.Client} client
 * @param {() => Promise<void>} run
 */
async function withMigrationLockTimeout(client, run) {
  const previous = await client.query("select current_setting('lock_timeout') as lock_timeout");
  const previousLockTimeout = String(previous.rows[0]?.lock_timeout ?? "0");

  await client.query("select set_config('lock_timeout', $1, false)", [tableLockTimeout]);

  try {
    await run();
  } finally {
    await client.query("select set_config('lock_timeout', $1, false)", [previousLockTimeout]);
  }
}

/** @param {pg.Client} client */
async function releaseMigrationLock(client) {
  await client.query("select pg_advisory_unlock(hashtext($1))", [migrationLockName]);
}

/** @param {pg.Client} client */
async function assertJournalIsConsistent(client) {
  const appliedRows = await client
    .query("select hash, created_at from drizzle.__drizzle_migrations")
    .then((result) => result.rows)
    .catch((/** @type {unknown} */ error) => {
      // A database that Drizzle has never touched has no journal table yet. That
      // is a fresh install, not an inconsistency.
      if (
        typeof error === "object" &&
        error !== null &&
        /** @type {{ code?: unknown }} */ (error).code === "42P01"
      ) {
        return [];
      }

      throw error;
    });

  const inconsistencies = findJournalInconsistencies({
    entries: readHashedJournalEntries(migrationsFolder),
    appliedMigrations: appliedRows.map((row) => ({
      hash: String(row.hash),
      createdAt: Number(row.created_at),
    })),
  });

  if (inconsistencies.length === 0) {
    return;
  }

  for (const inconsistency of inconsistencies) {
    const explanation =
      inconsistency.reason === "not-applied"
        ? "is older than the applied watermark but was never applied, so Drizzle will skip it forever"
        : "was applied with a different hash, so its .sql file changed after being applied";

    console.error(`[migrate] ${inconsistency.tag} ${explanation}.`);
  }

  throw new Error("Migration journal is inconsistent with drizzle.__drizzle_migrations.");
}

async function main() {
  const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("[migrate] DATABASE_DIRECT_URL (or DATABASE_URL) is required.");
    process.exit(1);
  }

  // A single client, not a pool: the advisory lock is session-scoped, so the
  // lock and the migrations it guards have to run on the same connection.
  const client = await connectWithRetry(databaseUrl);

  // Notices are noise ("schema already exists, skipping"); a warning is a
  // migration reporting rows it left for a person to fix.
  client.on("notice", (notice) => {
    if (notice.severity === "WARNING") {
      console.warn(`[migrate] ${notice.message}`);
    }
  });

  try {
    await acquireMigrationLock(client);

    try {
      await assertJournalIsConsistent(client);
      await withMigrationLockTimeout(client, () => migrate(drizzle(client), { migrationsFolder }));
      console.log("[migrate] migrations up to date.");
    } finally {
      await releaseMigrationLock(client);
    }
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  console.error("[migrate] failed, refusing to start the application.");
  console.error(error);
  process.exit(1);
}
