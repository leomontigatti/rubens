import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";
import type { Diagnostic } from "./lint.test-support.ts";

// The testing rules a machine can judge: the repo's own `tests` plugin
// (scripts/oxlint-tests-plugin.mjs).

const probes = lintProbes("tests");

// The 1-based line a diagnostic starts on.
const line = (d: Diagnostic) => d.labels[0]!.span.line;

const sleeps = (...files: string[]) =>
  probes.lint(...files).filter((d) => d.code === "tests(no-sleep-poll)");

const loopedSleeps = `import { setTimeout as delay } from "node:timers/promises";
import * as timers from "timers/promises";
import { scheduler as nodeScheduler } from "node:timers/promises";
import { vi } from "vite-plus/test";

vi.useFakeTimers({ toFake: ["Date"] });

declare const scheduler: { wait(ms: number): Promise<void> };
const record: number[] = [];

export async function arrowPoll() {
  while (record.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

export async function functionPoll() {
  do {
    await new Promise(function (resolve) {
      setTimeout(() => resolve(undefined), 1);
    });
  } while (record.length === 0);
}

export async function boundPoll() {
  while (record.length === 0) {
    await new Promise((resolve) => setTimeout(resolve.bind(null, undefined), 1));
    await new Promise((resolve) => setTimeout(() => resolve.call(null, undefined), 1));
  }
}

export async function importedPoll() {
  for (let tries = 0; record.length === 0; tries += 1) {
    await delay(1);
  }
  for (const _ of record) {
    await timers.setTimeout(1);
  }
}

export async function schedulerPoll(byKey: Record<string, number>) {
  for (const _ in byKey) {
    await scheduler.wait(1);
    await nodeScheduler.wait(1);
    await timers.scheduler.wait(1);
  }
}
`;

describe("Test lint rules", { timeout: 30_000 }, () => {
  const pollProbe = probes.probe("poll.test-support.ts", loopedSleeps);

  it("reject awaiting a timer in a loop in test code, in a helper and under faked Date, and say what to await", () => {
    const found = sleeps(pollProbe);

    // Each looped form's line in the probe.
    const lines = [...loopedSleeps.split("\n").entries()]
      .filter(([, line]) => line.trimStart().startsWith("await "))
      .map(([index]) => index + 1);
    expect(found.map(line)).toEqual(lines);
    expect(lines).toHaveLength(9);
    expect(found.map(text).join()).toContain("promise");
  });

  const outsideTestsProbe = probes.probe("retry.ts", loopedSleeps);

  it("accept a timer in a loop outside test code: a retry backs off on a timer", () => {
    expect(sleeps(outsideTestsProbe)).toEqual([]);
  });

  const singleSleepProbe = probes.probe(
    "single.test.ts",
    `export async function settle() {\n  await new Promise((resolve) => setTimeout(resolve, 1));\n}\n`,
  );

  it("accept a single timer outside a loop", () => {
    expect(sleeps(singleSleepProbe)).toEqual([]);
  });

  const signalProbe = probes.probe(
    "signal.test.ts",
    `const arrivals: Promise<void>[] = [];\n\nexport async function drain() {\n  while (arrivals.length > 0) {\n    await arrivals.shift();\n    await new Promise<void>((resolve) => queueMicrotask(resolve));\n  }\n}\n`,
  );

  it("accept a loop that awaits a real promise", () => {
    expect(sleeps(signalProbe)).toEqual([]);
  });

  const eventProbe = probes.probe(
    "event.test.ts",
    `import { EventEmitter } from "node:events";\n\nconst source = new EventEmitter();\n\nexport async function readies(count: number) {\n  for (let seen = 0; seen < count; seen += 1) {\n    await new Promise<void>((resolve) =>\n      source.once("ready", () => {\n        setTimeout(() => source.removeAllListeners(), 100);\n        resolve();\n      }),\n    );\n  }\n}\n`,
  );

  it("accept a loop that awaits an event whose handler starts an unrelated timer", () => {
    expect(sleeps(eventProbe)).toEqual([]);
  });
});
