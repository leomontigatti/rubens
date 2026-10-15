import { PgBoss } from "pg-boss";

// The start, not just the queue, lives on `globalThis`: the dev server
// re-evaluates this module on every edit, and a started queue never goes idle,
// so a module variable would leave one more running queue per edit. Caching the
// promise also keeps two concurrent first callers from starting two queues.
const globalForBoss = globalThis as typeof globalThis & { __rubensBoss?: Promise<PgBoss> };

/**
 * The pg-boss queue: reminders, confirmations, no-show marking (ADR-0001).
 *
 * It connects through `DATABASE_DIRECT_URL`, never a pooler: pg-boss relies on
 * session features (`LISTEN/NOTIFY`, advisory locks) that transaction pooling
 * breaks (ADR-0002). Started lazily, on the first job, so a request that never
 * enqueues opens no connection for it.
 */
export async function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__rubensBoss) {
    const starting = startBoss();
    globalForBoss.__rubensBoss = starting;
    // A failed start is not cached, so the next call tries again.
    starting.catch(() => {
      if (globalForBoss.__rubensBoss === starting) {
        globalForBoss.__rubensBoss = undefined;
      }
    });
  }
  return globalForBoss.__rubensBoss;
}

async function startBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_DIRECT_URL;
  if (!connectionString) {
    throw new Error("DATABASE_DIRECT_URL is required");
  }
  const boss = new PgBoss({ connectionString, max: 4 });
  boss.on("error", (error) => {
    console.error("[jobs]", error);
  });
  await boss.start();
  return boss;
}
