import { describe, expect, it } from "vite-plus/test";

import { choosePort, parseEnvPort, renderEnvLocal } from "./worktree-port.ts";

describe("choosePort", () => {
  it("is stable for the same worktree", () => {
    const first = choosePort("t3-a", new Set());

    expect(choosePort("t3-a", new Set())).toBe(first);
    expect(first).toBeGreaterThanOrEqual(5200);
    expect(first).toBeLessThan(6000);
  });

  it("steps past a port another worktree already claims", () => {
    const taken = choosePort("t3-a", new Set());

    expect(choosePort("t3-a", new Set([taken]))).toBe(taken === 5999 ? 5200 : taken + 1);
  });
});

describe("renderEnvLocal / parseEnvPort", () => {
  it("writes a file whose port reads back", () => {
    expect(parseEnvPort(renderEnvLocal(5321))).toBe(5321);
  });

  it("reads no port from a file without one", () => {
    expect(parseEnvPort('OTHER="x"\n')).toBeUndefined();
  });
});
