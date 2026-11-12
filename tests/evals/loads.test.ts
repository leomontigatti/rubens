import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vite-plus/test";

// The evals run on plain Node (`pnpm eval:assistant`), not through Vite, so a
// module Node cannot load breaks them only when someone pays for a run (#319
// did, with a value import through `#/`). This loads every module the eval
// entry points import, the way their scripts do, and calls no model.

const evalModules = [
  "./tests/evals/assistant/candidates.ts",
  "./tests/evals/assistant/cases.ts",
  "./tests/evals/assistant/provider.ts",
  "./tests/evals/assistant/score.ts",
  "./tests/evals/assistant/summary.ts",
  "./tests/evals/assistant/turn.ts",
  "./tests/evals/assistant/voice/notes.ts",
  "./tests/evals/assistant/voice/transcribers.ts",
  "./tests/evals/assistant/voice/wer.ts",
  "promptfoo",
];

describe("the evals' modules", () => {
  it("load under the pinned Node, as the eval scripts run them", () => {
    const loading = `await Promise.all(${JSON.stringify(evalModules)}.map((name) => import(name)));`;

    const run = spawnSync(
      process.execPath,
      ["--import", "./tests/evals/src-imports.ts", "--input-type=module", "-e", loading],
      { encoding: "utf8" },
    );

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  }, 60_000);
});
