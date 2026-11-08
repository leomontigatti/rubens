// Runs the assistant's evaluation on the named candidates (all when none is
// named), on demand and never in CI:
// `pnpm eval:assistant [label...] [--repeat N] [--concurrency N] [--case <id>...]`.
// Each turn's reply, calls and checks are kept in promptfoo's local store, for
// `pnpm exec promptfoo view`; the summary goes to stdout and results/.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import promptfoo, { type Assertion } from "promptfoo";

import { candidates, findCandidate } from "./candidates.ts";
import { cases, findCase } from "./cases.ts";
import { AssistantProvider } from "./provider.ts";
import { criteria, type Check, type Score } from "./score.ts";
import { asMarkdown, rowOf, summarize } from "./summary.ts";

function assertion([metric, key]: [string, keyof Score]): Assertion {
  return {
    type: "javascript",
    metric,
    value: (output: string) => {
      const check: Check = (JSON.parse(output) as { score: Score }).score[key];
      return { pass: check.pass, score: check.pass ? 1 : 0, reason: check.reason };
    },
  };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repeat: { type: "string", default: "1" },
    // Lower it for an account whose rate limit is tight.
    concurrency: { type: "string", default: "4" },
    case: { type: "string", multiple: true },
  },
});
const chosen = positionals.length ? positionals.map(findCandidate) : candidates;

const record = await promptfoo.evaluate(
  {
    description: `Assistant: ${chosen.map((each) => each.label).join(", ")}`,
    // The provider builds the whole conversation from the case; the prompt is only
    // the row label.
    prompts: ["{{caseId}}"],
    providers: chosen.map((candidate) => new AssistantProvider(candidate)) as never,
    defaultTest: { assert: criteria.map(assertion) },
    tests: (values.case ? values.case.map(findCase) : cases).map((evaluationCase) => ({
      description: evaluationCase.description,
      vars: { caseId: evaluationCase.id },
    })),
    writeLatestResults: true,
  },
  // A cached answer would hide how much a candidate varies between runs.
  {
    cache: false,
    maxConcurrency: Number(values.concurrency),
    repeat: Number(values.repeat),
    showProgressBar: false,
  },
);

const summary = await record.toEvaluateSummary();
const names = criteria.map(([metric]) => metric);
const rows = summary.results.map((result) => rowOf(result, names));
const table = asMarkdown(summarize(rows, names), names);

const directory = path.join(import.meta.dirname, "results");
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
writeFileSync(path.join(directory, `assistant-${stamp}.json`), JSON.stringify(summary, null, 2));
writeFileSync(path.join(directory, `assistant-${stamp}.md`), `${table}\n`);
console.log(table);
