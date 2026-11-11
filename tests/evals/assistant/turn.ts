// Runs one assistant turn of a case on one candidate: the system prompt, the
// conversation so far, the patient's new messages, and the tools against the
// case's fake object, through TanStack AI's agent loop.

import { chat, maxIterations, type ChatMiddleware, type ModelMessage } from "@tanstack/ai";

import { modelOptions, textAdapter, type Candidate } from "./candidates.ts";
import type { Case } from "./cases.ts";
import { fakeObject, type ToolCall } from "./fake-object.ts";
import { systemPrompt } from "./prompt.ts";
import { assistantTools } from "./tools.ts";

export type TurnResult = {
  reply: string;
  calls: ToolCall[];
  knownTimes: Set<string>;
  latencyMs: number;
  // `input` counts every prompt token, `cachedInput` the share served from cache.
  usage: { input: number; cachedInput: number; output: number };
  finishReason: string | null;
};

function conversation(evaluationCase: Case, patientMessages: string[]): ModelMessage[] {
  const history: ModelMessage[] = evaluationCase.history.map((turn) => ({
    role: turn.role === "patient" ? "user" : "assistant",
    content: turn.text,
  }));
  // A burst of short messages is one turn, as the patient sent them.
  return [...history, { role: "user", content: patientMessages.join("\n") }];
}

// A provider's rate limit or overload says nothing about the model, so the turn
// is run again from scratch; any other error is the candidate's and counts. A
// quota spent for the day (the free plans of Workers AI and Gemini) is not waited out.
const transient = /rate.?limit|\b429\b|overloaded|\b50[23]\b|temporarily unavailable/i;
const spent =
  /daily free allocation|exceeded your current quota|insufficient_quota|credit_balance/i;

// `patientMessages` stands in for the case's own, as a voice note's transcript does.
export async function runTurn(
  candidate: Candidate,
  evaluationCase: Case,
  patientMessages: string[] = evaluationCase.patient,
): Promise<TurnResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptTurn(candidate, evaluationCase, patientMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 6 || !transient.test(message) || spent.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

async function attemptTurn(
  candidate: Candidate,
  evaluationCase: Case,
  patientMessages: string[] = evaluationCase.patient,
): Promise<TurnResult> {
  const object = fakeObject(evaluationCase);
  const usage = { input: 0, cachedInput: 0, output: 0 };
  let finishReason: string | null = null;
  // onFinish reports the last model call's usage only, so every call is summed.
  const meter: ChatMiddleware = {
    name: "meter",
    onUsage: (_context, used) => {
      usage.input += used.promptTokens ?? 0;
      usage.cachedInput += used.promptTokensDetails?.cachedTokens ?? 0;
      usage.output += used.completionTokens ?? 0;
    },
    onFinish: (_context, info) => {
      finishReason = info.finishReason;
    },
  };

  const started = performance.now();
  const { text } = await chat({
    adapter: textAdapter(candidate),
    threadId: `eval-${evaluationCase.id}`,
    systemPrompts: [systemPrompt(evaluationCase)],
    messages: conversation(evaluationCase, patientMessages),
    tools: assistantTools(object),
    agentLoopStrategy: maxIterations(8),
    toolExecution: "sequential",
    middleware: [meter],
    modelOptions: modelOptions(candidate),
    ...(candidate.reasoning ? { reasoning: { level: candidate.reasoning } } : {}),
    stream: false,
  });

  return {
    reply: text,
    calls: object.calls,
    knownTimes: object.knownTimes,
    latencyMs: Math.round(performance.now() - started),
    usage,
    finishReason,
  };
}

export function costOf(candidate: Candidate, usage: TurnResult["usage"]): number | undefined {
  if (!candidate.rates) return undefined;
  const { input, cachedInput = input, output } = candidate.rates;
  const uncached = usage.input - usage.cachedInput;
  return (uncached * input + usage.cachedInput * cachedInput + usage.output * output) / 1_000_000;
}
