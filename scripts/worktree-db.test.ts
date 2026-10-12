import { describe, expect, it } from "vite-plus/test";

import {
  choosePort,
  databaseUrlFor,
  parseEnvPort,
  planPrune,
  renderEnvLocal,
  worktreeDatabaseName,
} from "./worktree-db.ts";

describe("worktreeDatabaseName", () => {
  it("names the database after the worktree directory", () => {
    expect(worktreeDatabaseName("/home/poto/.t3/worktrees/rubens/t3code-c2b191df")).toBe(
      "rubens-wt-t3code-c2b191df",
    );
  });

  it("folds characters Postgres would need quoting for", () => {
    expect(worktreeDatabaseName("/tmp/Fix_Seed.Race")).toBe("rubens-wt-fix-seed-race");
  });

  it("stays inside Postgres's 63-byte identifier limit", () => {
    expect(worktreeDatabaseName(`/tmp/${"a".repeat(80)}`)).toHaveLength(63);
  });
});

describe("databaseUrlFor", () => {
  it("keeps the base URL's server and swaps only the database", () => {
    expect(
      databaseUrlFor("postgres://rubens_app:rubens_app@localhost:5434/rubens", "rubens-wt-x"),
    ).toBe("postgres://rubens_app:rubens_app@localhost:5434/rubens-wt-x");
  });
});

describe("choosePort", () => {
  it("is stable for the same worktree", () => {
    const first = choosePort("rubens-wt-a", new Set());

    expect(choosePort("rubens-wt-a", new Set())).toBe(first);
    expect(first).toBeGreaterThanOrEqual(5200);
    expect(first).toBeLessThan(6000);
  });

  it("steps past a port another worktree already claims", () => {
    const taken = choosePort("rubens-wt-a", new Set());

    expect(choosePort("rubens-wt-a", new Set([taken]))).toBe(taken === 5999 ? 5200 : taken + 1);
  });
});

describe("renderEnvLocal / parseEnvPort", () => {
  it("writes a file whose port reads back", () => {
    const content = renderEnvLocal({
      databaseUrl: "postgres://rubens_app:rubens_app@localhost:5434/rubens-wt-x",
      directDatabaseUrl: "postgres://postgres:postgres@localhost:5434/rubens-wt-x",
      port: 5321,
    });

    expect(content).toContain(
      'DATABASE_URL="postgres://rubens_app:rubens_app@localhost:5434/rubens-wt-x"',
    );
    expect(content).toContain(
      'DATABASE_DIRECT_URL="postgres://postgres:postgres@localhost:5434/rubens-wt-x"',
    );
    expect(content).toContain('BETTER_AUTH_URL="http://localhost:5321"');
    expect(parseEnvPort(content)).toBe(5321);
  });

  it("reads no port from a file without one", () => {
    expect(parseEnvPort('DATABASE_URL="x"\n')).toBeUndefined();
  });
});

describe("planPrune", () => {
  it("drops only worktree databases whose worktree is gone", () => {
    expect(
      planPrune({
        databases: ["rubens", "rubens-test", "postgres", "rubens-wt-live", "rubens-wt-gone"],
        worktreePaths: ["/home/poto/projects/rubens", "/wt/live"],
      }),
    ).toEqual(["rubens-wt-gone"]);
  });
});
