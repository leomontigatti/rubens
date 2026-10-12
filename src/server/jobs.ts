import { PgBoss } from "pg-boss";

let bossInstance: PgBoss | undefined;

/**
 * The pg-boss queue: reminders, confirmations, no-show marking (ADR-0001).
 *
 * It connects through `DATABASE_DIRECT_URL`, never a pooler: pg-boss relies on
 * session features (`LISTEN/NOTIFY`, advisory locks) that transaction pooling
 * breaks (ADR-0002). Started lazily, on the first job, so a request that never
 * enqueues opens no connection for it.
 */
export async function getBoss(): Promise<PgBoss> {
  if (!bossInstance) {
    const connectionString = process.env.DATABASE_DIRECT_URL;
    if (!connectionString) {
      throw new Error("DATABASE_DIRECT_URL is required");
    }
    const boss = new PgBoss({ connectionString, max: 4 });
    boss.on("error", (error) => {
      console.error("[jobs]", error);
    });
    await boss.start();
    bossInstance = boss;
  }
  return bossInstance;
}
