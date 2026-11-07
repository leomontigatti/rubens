// Rebuilds the summary table from saved runs, so runs made apart (one provider
// at a time, say) read as one table: `pnpm eval:report
// tests/evals/assistant/results/assistant-<stamp>.json...`. Each turn is scored again by today's
// score.ts, replaying its tool calls through the fake object, so a fix to a check
// needs no new run. A run saved without a cost gets one from the candidate's rates.

import { readFileSync } from "node:fs";

import { candidates } from "./candidates.ts";
import { findCase, type ToolName } from "./cases.ts";
import { fakeObject } from "./fake-object.ts";
import { criteria, score } from "./score.ts";
import { asMarkdown, rowOf, summarize, type Result } from "./summary.ts";

type Saved = Result & {
  vars: { caseId: string };
  response?: (Result["response"] & { output?: string }) | null;
};

const names = criteria.map(([metric]) => metric);

function costOf(label: string, input: number, output: number): number | undefined {
  const rates = candidates.find((each) => each.label === label)?.rates;
  return rates ? (input * rates.input + output * rates.output) / 1_000_000 : undefined;
}

function rescored(result: Saved): Saved {
  if (result.failureReason === 2 || !result.response?.output) return result;
  const turn = JSON.parse(result.response.output) as {
    reply: string;
    calls: Array<{ name: ToolName; args: Record<string, unknown> }>;
  };
  const evaluationCase = findCase(result.vars.caseId);
  const object = fakeObject(evaluationCase);
  for (const call of turn.calls) object.run(call.name, call.args);
  const checks = score(evaluationCase, {
    ...turn,
    calls: object.calls,
    knownTimes: object.knownTimes,
  });
  const namedScores = Object.fromEntries(
    criteria.map(([metric, key]) => [metric, checks[key].pass ? 1 : 0]),
  );
  const passed = Object.values(namedScores).every((value) => value === 1);
  return { ...result, namedScores, failureReason: passed ? 0 : 1 };
}

const rows = process.argv.slice(2).flatMap((file) => {
  const saved = JSON.parse(readFileSync(file, "utf8")) as { results: Saved[] };
  return saved.results.map((result) => rowOf(rescored(result), names, costOf));
});
console.log(asMarkdown(summarize(rows, names), names));
