import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Only the pool's reuse is under test. Each re-import would otherwise transform
// the schema and drizzle again, which outlasts the test timeout under a full run.
vi.mock("./schema/index.ts", () => ({}));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: (client: Pool) => ({ $client: client }),
}));

const opened = new Set<Pool>();

async function importPool(): Promise<Pool> {
  vi.resetModules();
  const { db } = await import("./client.ts");
  opened.add(db.$client);
  return db.$client;
}

describe("db client", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://rubens_app@localhost:5434/unused");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all([...opened].map((pool) => pool.end()));
    opened.clear();
    delete (globalThis as Record<string, unknown>).__rubensDbPool;
  });

  it("reuses the pool when the dev server re-evaluates the module", async () => {
    const first = await importPool();
    const second = await importPool();

    expect(second).toBe(first);
  });
});
