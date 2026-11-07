// Runs the voice-note evaluation: each note through each named transcription
// option (all when none is named), then the transcript through one assistant
// candidate, held to the note's text case. On demand, never in CI:
// `pnpm eval:voice [label...] --assistant <candidate> [--repeat N]`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import promptfoo, {
  type ApiProvider,
  type Assertion,
  type CallApiContextParams,
  type ProviderResponse,
} from "promptfoo";

import { findCandidate, type Candidate } from "../candidates.ts";
import { findCase } from "../cases.ts";
import { score } from "../score.ts";
import { asMarkdown, rowOf, summarize, type Row } from "../summary.ts";
import { runTurn } from "../turn.ts";
import { voiceNotes } from "./notes.ts";
import { findTranscriber, transcribers, type Transcriber } from "./transcribers.ts";
import { wordErrorRate } from "./wer.ts";

// Above this share of words wrong, a transcript is not one the assistant should act on.
const maximumWordErrorRate = 0.2;

type Output = { transcript: string; wordErrorRate: number; turnPassed: boolean; turn: unknown };

class VoiceProvider implements ApiProvider {
  readonly label: string;
  private readonly transcriber: Transcriber;
  private readonly assistant: Candidate;

  constructor(transcriber: Transcriber, assistant: Candidate) {
    this.transcriber = transcriber;
    this.assistant = assistant;
    this.label = transcriber.label;
  }

  id(): string {
    return this.transcriber.label;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const note = voiceNotes.find((each) => each.id === context?.vars.noteId);
    if (!note) return { error: `No voice note ${context?.vars.noteId as string}` };
    const bytes = readFileSync(path.join(import.meta.dirname, note.file));
    const audio = new File([bytes], note.file, { type: "audio/ogg" });
    try {
      const started = performance.now();
      const transcript = await this.transcriber.transcribe(audio, note.seconds);
      const latencyMs = Math.round(performance.now() - started);
      const evaluationCase = findCase(note.caseId);
      const turn = await runTurn(this.assistant, evaluationCase, [transcript.text]);
      const checks = score(evaluationCase, turn);
      const output: Output = {
        transcript: transcript.text,
        wordErrorRate: wordErrorRate(note.spoken, transcript.text),
        turnPassed: checks.toolChoice.pass && checks.availability.pass && checks.handoff.pass,
        turn: {
          reply: turn.reply,
          calls: turn.calls.map(({ name, args }) => ({ name, args })),
          checks,
        },
      };
      // The latency and cost are the transcription's: the turn's are the text run's.
      return { output: JSON.stringify(output), latencyMs, cost: transcript.cost };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

const criteria: Array<[string, (output: Output) => boolean, (output: Output) => string]> = [
  [
    "3a transcript",
    (output) => output.wordErrorRate <= maximumWordErrorRate,
    (output) => `WER ${output.wordErrorRate.toFixed(2)}: ${output.transcript}`,
  ],
  [
    "3b turn on the transcript",
    (output) => output.turnPassed,
    (output) => JSON.stringify(output.turn),
  ],
];

function assertion([metric, passes, reason]: (typeof criteria)[number]): Assertion {
  return {
    type: "javascript",
    metric,
    value: (raw: string) => {
      const output = JSON.parse(raw) as Output;
      const pass = passes(output);
      return { pass, score: pass ? 1 : 0, reason: reason(output) };
    },
  };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { assistant: { type: "string" }, repeat: { type: "string", default: "1" } },
});
if (!values.assistant) throw new Error("Name the assistant candidate with --assistant <label>");
const assistant = findCandidate(values.assistant);
const chosen = positionals.length ? positionals.map(findTranscriber) : transcribers;

const record = await promptfoo.evaluate(
  {
    description: `Voice notes on ${assistant.label}: ${chosen.map((each) => each.label).join(", ")}`,
    prompts: ["{{noteId}}"],
    providers: chosen.map((transcriber) => new VoiceProvider(transcriber, assistant)) as never,
    defaultTest: { assert: criteria.map(assertion) },
    tests: voiceNotes.map((note) => ({
      description: `${note.id}${note.noisy ? " (noisy)" : ""}`,
      vars: { noteId: note.id },
    })),
    writeLatestResults: true,
  },
  { cache: false, maxConcurrency: 4, repeat: Number(values.repeat), showProgressBar: false },
);

const summary = await record.toEvaluateSummary();
const names = criteria.map(([metric]) => metric);
const rows: Array<Row & { wordErrorRate?: number }> = summary.results.map((result) => ({
  ...rowOf(result, names),
  wordErrorRate: result.response?.output
    ? (JSON.parse(String(result.response.output)) as Output).wordErrorRate
    : undefined,
}));
const meanWordErrorRate = (label: string) => {
  const rates = rows.filter((row) => row.candidate === label && row.wordErrorRate !== undefined);
  return rates.reduce((sum, row) => sum + (row.wordErrorRate ?? 0), 0) / Math.max(1, rates.length);
};
const table = [
  asMarkdown(summarize(rows, names), names),
  "",
  ...chosen.map((each) => `- ${each.label}: mean WER ${meanWordErrorRate(each.label).toFixed(3)}`),
].join("\n");

const directory = path.join(import.meta.dirname, "..", "results");
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
writeFileSync(path.join(directory, `voice-${stamp}.json`), JSON.stringify(summary, null, 2));
writeFileSync(path.join(directory, `voice-${stamp}.md`), `${table}\n`);
console.log(table);
