import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// A stand-in for pg-boss: `start()` would need a database, and what is under
// test is how many queues get built and started, not pg-boss itself.
const fake = vi.hoisted(() => ({ constructed: 0, started: 0, failNextStart: false }));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    constructor() {
      fake.constructed += 1;
    }
    on() {}
    async start() {
      await Promise.resolve();
      if (fake.failNextStart) {
        fake.failNextStart = false;
        throw new Error("start failed");
      }
      fake.started += 1;
    }
  },
}));

async function importGetBoss() {
  vi.resetModules();
  const { getBoss } = await import("./jobs.ts");
  return getBoss;
}

describe("getBoss", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_DIRECT_URL", "postgres://rubens@localhost:5434/unused");
    Object.assign(fake, { constructed: 0, started: 0, failNextStart: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).__rubensBoss;
  });

  it("reuses the started queue when the dev server re-evaluates the module", async () => {
    const first = await (await importGetBoss())();
    const second = await (await importGetBoss())();

    expect(second).toBe(first);
    expect(fake.started).toBe(1);
  });

  it("starts one queue for concurrent first callers", async () => {
    const getBoss = await importGetBoss();

    const [first, second] = await Promise.all([getBoss(), getBoss()]);

    expect(second).toBe(first);
    expect(fake.constructed).toBe(1);
    expect(fake.started).toBe(1);
  });

  it("retries the start on the next call after a failed one", async () => {
    const getBoss = await importGetBoss();
    fake.failNextStart = true;

    await expect(getBoss()).rejects.toThrow("start failed");
    await expect(getBoss()).resolves.toBeDefined();
    expect(fake.started).toBe(1);
  });
});
