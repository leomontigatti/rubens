// promptfoo's provider for the assistant: one call runs one case's turn on one
// candidate, and returns the reply, the tool calls and their score as JSON for
// the suite's assertions.

import type { ApiProvider, CallApiContextParams, ProviderResponse } from "promptfoo";

import type { Candidate } from "./candidates.ts";
import { findCase } from "./cases.ts";
import { score } from "./score.ts";
import { costOf, runTurn } from "./turn.ts";

export class AssistantProvider implements ApiProvider {
  private readonly candidate: Candidate;
  readonly label: string;

  constructor(candidate: Candidate) {
    this.candidate = candidate;
    this.label = candidate.label;
  }

  id(): string {
    return this.candidate.label;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const evaluationCase = findCase(context?.vars.caseId as string);
    try {
      const turn = await runTurn(this.candidate, evaluationCase);
      const calls = turn.calls.map(({ name, args, result }) => ({ name, args, result }));
      return {
        output: JSON.stringify({
          reply: turn.reply,
          calls,
          score: score(evaluationCase, turn),
          finishReason: turn.finishReason,
          cachedInput: turn.usage.cachedInput,
        }),
        latencyMs: turn.latencyMs,
        tokenUsage: {
          prompt: turn.usage.input,
          completion: turn.usage.output,
          total: turn.usage.input + turn.usage.output,
        },
        cost: costOf(this.candidate, turn.usage),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
