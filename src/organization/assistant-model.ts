import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import type { AnyTool } from "@tanstack/ai";
import { createAnthropicChat } from "@tanstack/ai-anthropic";

import { assistantModelId, assistantToolSchemas } from "#/lib/assistant.ts";
import type { AssistantToolName } from "#/lib/assistant.ts";

// The assistant's model port (ADR-0006 § TanStack AI): one turn in, the reply
// out, with the turn's tools run by the object in between. Claude Haiku 5.5
// through TanStack AI's Anthropic adapter; the object's tests put a scripted
// model behind the same port (`assistant-model.test-support.ts`). The API key
// is a Worker secret and never leaves this module.

/** A tool of the turn, run by the object with the permissions of the patient's number. */
export interface AssistantTool {
  name: AssistantToolName;
  run(args: unknown): unknown;
}

/** A message of the conversation so far: the patient's, or the organization's number's. */
export interface TurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelTurn {
  /** The conversation the turn answers, TanStack AI's thread. */
  conversationId: string;
  system: string;
  messages: TurnMessage[];
  tools: AssistantTool[];
}

export interface AssistantModel {
  /** The setting that keeps a turn from running, or `null` when none is missing. */
  missingSetting(): "missingApiKey" | null;
  /** Runs one turn: the model calls the tools as it needs, then writes the reply. */
  runTurn(turn: ModelTurn): Promise<{ reply: string }>;
}

/** A turn's model calls: enough for a lookup or two, the judgement and the reply. */
const maxModelCalls = 8;

export function assistantModelFor(env: { ANTHROPIC_API_KEY?: string }): AssistantModel {
  return {
    missingSetting: () => (env.ANTHROPIC_API_KEY ? null : "missingApiKey"),
    async runTurn({ conversationId, system, messages, tools }) {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("The assistant has no Anthropic API key: check missingSetting() first");
      }
      const { text } = await chat({
        adapter: createAnthropicChat(assistantModelId, apiKey),
        threadId: conversationId,
        systemPrompts: [system],
        messages,
        tools: tools.map((tool): AnyTool =>
          toolDefinition({ name: tool.name, ...assistantToolSchemas[tool.name] }).server((args) =>
            tool.run(args),
          ),
        ),
        agentLoopStrategy: maxIterations(maxModelCalls),
        toolExecution: "sequential",
        stream: false,
      });
      return { reply: text };
    },
  };
}
