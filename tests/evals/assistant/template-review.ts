// The template review (#345) on the real model, once, through the app's own
// adapter (`assistantModelFor`): a promotional text must get notes and a clean
// one none, each answer parsed as `{ notes: string[] }`. The object's tests run
// the review on a scripted model only. On demand, never in CI:
// `pnpm eval:template-review`. Exits 1 when either text gets the wrong answer.

import { assistantModelFor } from "../../../src/organization/assistant-model.ts";

import { findCandidate } from "./candidates.ts";
import { costOf } from "./turn.ts";

const texts = [
  {
    name: "promotional",
    wantsNotes: true,
    body: "Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. Este mes tenés 20% de descuento en blanqueamiento dental, reservá el tuyo! Y seguinos en Instagram.",
  },
  {
    name: "clean",
    wantsNotes: false,
    body: "Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si no podés venir, respondé este mensaje.",
  },
];

const model = assistantModelFor({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
if (model.missingSetting()) throw new Error("Set ANTHROPIC_API_KEY to run the template review");

const haiku = findCandidate("claude-haiku-5-5");
let failed = false;
for (const text of texts) {
  const usage = { input: 0, cachedInput: 0, output: 0 };
  const started = performance.now();
  const { notes } = await model.reviewTemplate({
    body: text.body,
    formOfAddress: "vos",
    tone: "",
    recordUsage: (used) => {
      usage.input += used.inputTokens;
      usage.output += used.outputTokens;
    },
  });
  const latencyMs = Math.round(performance.now() - started);
  const pass = Array.isArray(notes) && notes.length > 0 === text.wantsNotes;
  failed ||= !pass;
  console.log(
    JSON.stringify(
      { text: text.name, pass, notes, latencyMs, usage, costUsd: costOf(haiku, usage) },
      null,
      2,
    ),
  );
}
if (failed) process.exitCode = 1;
