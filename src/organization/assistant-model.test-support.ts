import { runDurableObjectAlarm } from "cloudflare:test";
import { vi } from "vite-plus/test";

import { assistantWaitMs } from "#/lib/assistant.ts";
import type { AssistantToolName } from "#/lib/assistant.ts";

import type {
  AssistantModel,
  CheckedReply,
  ModelTurn,
  ReplyToCheck,
} from "#/organization/assistant-model.ts";
import type { Organization } from "#/organization/organization.ts";

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

/** What the clinical check finds in a reply, or that it failed; a reply nothing scripts passes. */
type CheckScript = CheckedReply | "fails";

class ScriptedModel implements AssistantModel {
  /** Every turn the object ran, in order. */
  turns: ModelTurn[] = [];
  calls: ToolCall[] = [];
  /** Every reply the object asked the clinical check about, in order. */
  checks: ReplyToCheck[] = [];
  /** Whether the Worker has the model's API key. */
  hasApiKey = true;
  #scripts: Script[] = [];
  #checkScripts: CheckScript[] = [];

  reset() {
    this.turns = [];
    this.calls = [];
    this.checks = [];
    this.hasApiKey = true;
    this.#scripts = [];
    this.#checkScripts = [];
  }

  /** What the clinical check finds in the next reply it is asked about; queued in order. */
  scriptCheck(found: CheckScript) {
    this.#checkScripts.push(found);
  }

  async checkReply(request: ReplyToCheck) {
    this.checks.push(request);
    const found = this.#checkScripts.shift() ?? { clinical: false, otherPatient: false };
    if (found === "fails") {
      throw new Error("The scripted clinical check failed");
    }
    return found;
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

/** A text from `from`, stored as Meta's webhook hands it over, sent now by Meta's clock unless `sentAt` says. */
export async function patientWrites(
  organization: DurableObjectStub<Organization>,
  text: string,
  from: string,
  sentAt = Date.now(),
) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  const stored = await organization.storeWhatsappEvents({
    messages: [{ whatsappId, from, sentAt, type: "text", text, payload: "{}" }],
    statuses: [],
    templateStatuses: [],
  });
  if (!stored.ok) {
    throw new Error(`storeWhatsappEvents refused: ${stored.reason}`);
  }
  return whatsappId;
}

/** A photo, a document or another message with no text from `from`, as Meta's webhook hands it over. */
export async function patientSends(
  organization: DurableObjectStub<Organization>,
  type: string,
  from: string,
) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  const stored = await organization.storeWhatsappEvents({
    messages: [
      { whatsappId, from, sentAt: Date.now(), type, text: null, payload: '{"caption":"mirá"}' },
    ],
    statuses: [],
    templateStatuses: [],
  });
  if (!stored.ok) {
    throw new Error(`storeWhatsappEvents refused: ${stored.reason}`);
  }
  return whatsappId;
}

/** Moves the object's faked clock past the assistant's wait, and runs its alarm. */
export async function afterTheWait(organization: DurableObjectStub<Organization>) {
  vi.setSystemTime(Date.now() + assistantWaitMs);
  await runDurableObjectAlarm(organization);
}
