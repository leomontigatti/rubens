import type { AssistantToolName } from "#/lib/assistant.ts";

import type { AssistantModel, ModelTurn } from "#/organization/assistant-model.ts";

// The assistant's model scripted, for the organization object's tests
// (`docs/agents/tdd-db.md`): a test writes what the model does in a turn,
// which calls the object's real tools through the same port the real model
// uses. `organization.test-support.ts` re-exports it.

/** A turn as a script sees it: the request, and a way to call one of its tools. */
interface ScriptedTurn extends ModelTurn {
  call(name: AssistantToolName, args?: Record<string, unknown>): unknown;
}

/** What the model does in one turn: calls tools, then returns its reply. */
type Script = (turn: ScriptedTurn) => string | Promise<string>;

/** A tool call a scripted turn made, with what the object returned. */
interface ToolCall {
  name: AssistantToolName;
  args: Record<string, unknown>;
  result: unknown;
}

/** The turn a test does not script: it judges the messages as nothing special, and replies. */
const plainTurn: Script = (turn) => {
  turn.call("judge_messages", { clinical: false, emergency: false });
  return "Hola, ¿en qué te puedo ayudar?";
};

class ScriptedModel implements AssistantModel {
  /** Every turn the object ran, in order. */
  turns: ModelTurn[] = [];
  calls: ToolCall[] = [];
  /** Whether the Worker has the model's API key. */
  hasApiKey = true;
  #scripts: Script[] = [];

  reset() {
    this.turns = [];
    this.calls = [];
    this.hasApiKey = true;
    this.#scripts = [];
  }

  /** What the model does in the next unscripted turn; queued in order. */
  script(script: Script) {
    this.#scripts.push(script);
  }

  missingSetting() {
    return this.hasApiKey ? null : ("missingApiKey" as const);
  }

  async runTurn(turn: ModelTurn) {
    this.turns.push(turn);
    const script = this.#scripts.shift() ?? plainTurn;
    const call = (name: AssistantToolName, args: Record<string, unknown> = {}) => {
      const tool = turn.tools.find((one) => one.name === name);
      if (!tool) {
        throw new Error(`The turn has no tool ${name}`);
      }
      const result = tool.run(args);
      this.calls.push({ name, args, result });
      return result;
    };
    return { reply: await script({ ...turn, call }) };
  }
}

/**
 * The model a test installs, with `vi.mock(import("#/organization/assistant-model.ts"), …)`
 * returning it from `assistantModelFor`. The factory reads it only inside the
 * function it returns: `vi.mock` is hoisted above the imports.
 */
export const scriptedModel = new ScriptedModel();
