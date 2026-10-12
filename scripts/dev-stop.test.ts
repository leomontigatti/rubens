import { describe, expect, it } from "vite-plus/test";

import { planStop } from "./dev-stop.ts";

const ROOT = "/home/poto/.t3/worktrees/rubens/t3code-aaaa";

describe("planStop", () => {
  it("stops the listener that runs from this worktree", () => {
    expect(
      planStop({
        root: ROOT,
        listeners: [
          { pid: 101, cwd: ROOT },
          { pid: 102, cwd: `${ROOT}/app` },
        ],
      }),
    ).toEqual({ stop: [101, 102], foreign: [] });
  });

  it("leaves alone a listener that runs from anywhere else, a sibling worktree included", () => {
    const sibling = { pid: 201, cwd: `${ROOT}-copy` };
    const unknown = { pid: 202, cwd: null };

    expect(planStop({ root: ROOT, listeners: [sibling, unknown] })).toEqual({
      stop: [],
      foreign: [sibling, unknown],
    });
  });
});
