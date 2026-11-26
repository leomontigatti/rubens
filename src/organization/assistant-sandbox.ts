import { and, asc, count, eq, gt, inArray } from "drizzle-orm";

import { isFull, sandboxModelCallsPerHour, sandboxTurnSchema } from "#/lib/assistant-sandbox.ts";
import type { SandboxState, SandboxTurnInput } from "#/lib/assistant-sandbox.ts";
import { windowClosesAt } from "#/lib/conversation-window.ts";
import { phoneSpellings } from "#/lib/phones.ts";
import { present } from "#/lib/present.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { splitReply } from "#/lib/reply-pacing.ts";

import { judgeTurn } from "#/organization/assistant.ts";
import { readConversation } from "#/organization/turn-reading.ts";
import { settleTurn } from "#/organization/turn-settling.ts";
import type { TurnMode } from "#/organization/assistant.ts";
import { upcomingAppointments } from "#/organization/assistant-appointments.ts";
import { maxModelCalls } from "#/organization/assistant-model.ts";
import type { AssistantModel, AssistantTool } from "#/organization/assistant-model.ts";
import type { Database } from "#/organization/database.ts";
import { answeredMessage } from "#/organization/handoffs.ts";
import { applyChange } from "#/organization/proposals.ts";
import { reminderTemplate, scenarioOf } from "#/organization/assistant-sandbox-scenarios.ts";
import { appointment } from "#/organization/schema.ts";
import {
  handoffReplyText,
  checkThatHolds,
  holdForReception,
  openHeldReply,
  repliesFirst,
  replyTexts,
  says,
} from "#/organization/turn-replies.ts";
import {
  conversation,
  handoff,
  outboxMessage,
  proposal,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { modelUsage } from "#/organization/assistant-usage-schema.ts";

// The assistant's sandbox (docs/domain/assistant.md § Trying it): an admin
// plays the patient against the real assistant, with its real tools on the
// real agenda, and nothing is kept. Its conversation lives in the page
// (`src/lib/assistant-sandbox.ts`); every step of a turn that reads or writes
// the object's storage replays that conversation into a transaction, runs the
// assistant's own code there, reads back what it left, and rolls the
// transaction back. So no appointment changes, nothing is queued, the sandbox's
// conversation and proposals never meet the real ones, and nothing reaches
// Meta: the sandbox has no Graph API client. Its model runs are recorded
// outside those transactions, as sandbox use, and an hour's are limited.

const hourMs = 60 * 60_000;

/**
 * The sandbox turns the object is running now, each held against the hour's
 * limit at the most a turn can make, so turns started together cannot pass it
 * together. The calls a running turn already recorded count twice meanwhile:
 * near the limit a turn is refused a little early, never late.
 */
export interface SandboxTurnsRunning {
  count: number;
}

/** The most model calls one turn makes: its own, and the clinical check of its reply. */
const callsPerTurn = maxModelCalls + 1;

/** Whether the sandbox ran, or may still run, the model as often as an hour allows. */
function overHourlyLimit(database: Database, running: SandboxTurnsRunning) {
  const { calls } = database
    .select({ calls: count() })
    .from(modelUsage)
    .where(and(eq(modelUsage.sandbox, true), gt(modelUsage.createdAt, Date.now() - hourMs)))
    .get() ?? { calls: 0 };
  return calls + running.count * callsPerTurn >= sandboxModelCallsPerHour;
}

class Rollback extends Error {}

/** A tool call of a sandbox turn, as JSON: what the model asked, and what the object returned. */
interface ToolCall {
  name: AssistantTool["name"];
  args: string;
  result: string;
}

/** The ids an accepted booking minted: its appointment, and the patient it registered. */
function mintedBy(kept: SandboxState["proposals"][number]) {
  if (kept.kind !== "book") {
    return [];
  }
  const registered = kept.statement.newPatient === undefined ? null : kept.patientId;
  return [kept.appointmentId, registered].filter((id) => id !== null);
}

/** One sandbox turn: its conversation, carried from step to step, and the tool calls it shows. */
class SandboxRun {
  toolCalls: ToolCall[] = [];
  readonly mode: TurnMode = {
    sandbox: true,
    step: (name, args, run) => {
      const result = this.step(run);
      this.toolCalls.push({
        name,
        args: JSON.stringify(args ?? {}),
        result: JSON.stringify(result),
      });
      return result;
    },
  };

  constructor(
    readonly database: Database,
    public state: SandboxState,
    private readonly phone: string,
  ) {}

  /**
   * Runs `work` on the object's storage with the sandbox conversation in it,
   * keeps what `work` left of that conversation, and discards every write.
   */
  step<T>(work: () => T): T {
    const kept: { result?: T; state: SandboxState } = { state: this.state };
    try {
      this.database.transaction(() => {
        this.#replay();
        kept.result = work();
        kept.state = this.#readBack();
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    this.state = kept.state;
    return kept.result as T;
  }

  /** Appends a message, after the last one: a turn's replies follow its patient's message. */
  append(direction: "incoming" | "outgoing", text: string) {
    const last = present(this.state.messages.at(-1), "A sandbox has its reminder");
    const sentAt = Math.max(Date.now(), last.sentAt + 1);
    this.state = {
      ...this.state,
      messages: [...this.state.messages, { direction, text, sentAt, judgement: null }],
    };
  }

  #messageId(index: number) {
    return `${this.state.conversationId}:${index}`;
  }

  /** Writes the sandbox conversation into the open transaction. */
  #replay() {
    const { database, state } = this;
    const { conversationId } = state;
    // The number's real conversation, if any, steps aside: a number has one conversation.
    database
      .update(conversation)
      .set({ phone: `sandbox:${conversationId}` })
      .where(inArray(conversation.phone, phoneSpellings(this.phone)))
      .run();
    database
      .insert(conversation)
      .values({
        id: conversationId,
        phone: this.phone,
        misunderstandings: state.misunderstandings,
      })
      .run();
    // A row per insert, as `notify` inserts: the object's SQLite binds at most 100 parameters a query.
    for (const [index, message] of state.messages.entries()) {
      database
        .insert(whatsappMessage)
        .values({
          ...message,
          id: this.#messageId(index),
          conversationId,
          whatsappId: `sandbox.${this.#messageId(index)}`,
          type: "text",
          payload: "{}",
        })
        .run();
    }
    const booked = database
      .select({ medicalServiceId: appointment.medicalServiceId })
      .from(appointment)
      .where(eq(appointment.id, state.appointmentId))
      .get();
    const reminder = booked && reminderTemplate(database, booked.medicalServiceId);
    if (reminder) {
      database
        .insert(outboxMessage)
        .values({
          kind: "timed",
          templateId: reminder.id,
          timing: "before",
          appointmentId: state.appointmentId,
          state: "sent",
          dueAt: present(state.messages[0], "A sandbox has its reminder").sentAt,
          whatsappMessageId: this.#messageId(0),
        })
        .run();
    }
    const unlessLost = this.#replayProposals();
    for (const kept of state.handoffs) {
      database
        .insert(handoff)
        .values({ ...kept, appointmentId: unlessLost(kept.appointmentId), conversationId })
        .run();
    }
  }

  /**
   * The sandbox's own changes hold in its later steps: made again, by the same
   * functions, whose rules run again, a booking under the appointment and
   * patient ids its first acceptance minted, so later steps can act on them.
   * One they refuse now (its new time was booked meanwhile, its cutoff
   * passed, reception confirmed it for real) is no longer accepted (#257). A
   * booking no longer made names no appointment or patient it minted, and a
   * proposal about one of those is not made either and can no longer be
   * accepted. Returns how an id reads now: none once its booking is lost, for
   * the handoffs about it.
   */
  #replayProposals() {
    const { database, state } = this;
    const { conversationId } = state;
    // Each id a booking no longer made had minted, with that booking's proposal.
    const lost = new Map<string, string>();
    const strands = (kept: SandboxState["proposals"][number]) =>
      [kept.appointmentId, kept.patientId].some(
        (id) => id !== null && lost.has(id) && lost.get(id) !== kept.id,
      );
    const stillMade = new Set<string>();
    const accepted = state.proposals
      .filter((kept) => kept.acceptedAt !== null)
      .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
    for (const kept of accepted) {
      const change = { ...kept, conversationId, updatedAt: kept.createdAt };
      if (!strands(kept) && applyChange(database, change).ok) {
        stillMade.add(kept.id);
        continue;
      }
      for (const id of mintedBy(kept)) {
        lost.set(id, kept.id);
      }
    }
    const unlessLost = (id: string | null) => (id !== null && lost.has(id) ? null : id);
    for (const kept of state.proposals) {
      database
        .insert(proposal)
        .values({
          ...kept,
          acceptedAt: stillMade.has(kept.id) ? kept.acceptedAt : null,
          appointmentId: unlessLost(kept.appointmentId),
          patientId: unlessLost(kept.patientId),
          ...(strands(kept) && { expiresAt: kept.createdAt }),
          conversationId,
        })
        .run();
    }
    return unlessLost;
  }

  /** What the open transaction holds of the sandbox conversation. */
  #readBack(): SandboxState {
    const { database, state } = this;
    const { conversationId } = state;
    const stored = database
      .select({ misunderstandings: conversation.misunderstandings })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get();
    const { misunderstandings } = present(stored, "The sandbox is stored");
    const judgements = new Map(
      database
        .select({ id: whatsappMessage.id, judgement: whatsappMessage.judgement })
        .from(whatsappMessage)
        .where(eq(whatsappMessage.conversationId, conversationId))
        .all()
        .map((row) => [row.id, row.judgement]),
    );
    const proposals = database
      .select({
        id: proposal.id,
        appointmentId: proposal.appointmentId,
        kind: proposal.kind,
        statement: proposal.statement,
        patientId: proposal.patientId,
        medicalServiceId: proposal.medicalServiceId,
        practitionerId: proposal.practitionerId,
        roomId: proposal.roomId,
        startsAt: proposal.startsAt,
        endsAt: proposal.endsAt,
        expiresAt: proposal.expiresAt,
        acceptedAt: proposal.acceptedAt,
        createdAt: proposal.createdAt,
      })
      .from(proposal)
      .where(eq(proposal.conversationId, conversationId))
      .orderBy(asc(proposal.createdAt))
      .all();
    const handoffs = database
      .select({
        reason: handoff.reason,
        forPractitioner: handoff.forPractitioner,
        appointmentId: handoff.appointmentId,
        heldReply: handoff.heldReply,
        heldBecause: handoff.heldBecause,
      })
      .from(handoff)
      .where(and(eq(handoff.conversationId, conversationId), eq(handoff.state, "open")))
      .all();
    return {
      ...state,
      misunderstandings,
      messages: state.messages.map((message, index) => ({
        ...message,
        judgement: judgements.get(this.#messageId(index)) ?? null,
      })),
      proposals,
      handoffs,
    };
  }
}

/**
 * The admin's `text` as the patient's next message in the sandbox
 * conversation, and the assistant's turn on it: its tool calls, its
 * judgement, what the patient would be told, and the reply a check would
 * hold.
 */
export async function runSandboxTurn(
  database: Database,
  model: AssistantModel,
  running: SandboxTurnsRunning,
  input: SandboxTurnInput,
) {
  const parsed = sandboxTurnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const refusal = turnRefusal(database, model, running);
  if (refusal) {
    return { ok: false, reason: refusal } as const;
  }
  if (isFull(parsed.data.state)) {
    return { ok: false, reason: "conversationFull" } as const;
  }
  const scenario = scenarioOf(database, parsed.data.state.appointmentId);
  if (!scenario) {
    return { ok: false, reason: "notFound" } as const;
  }
  const run = new SandboxRun(database, parsed.data.state, scenario.phone);
  run.append("incoming", parsed.data.text);
  running.count += 1;
  try {
    return answer(run, await playTurn(run, model));
  } finally {
    running.count -= 1;
  }
}

/** Why no sandbox turn may run now: the model has no key, or the hour's limit was reached. */
function turnRefusal(database: Database, model: AssistantModel, running: SandboxTurnsRunning) {
  if (model.missingSetting()) {
    return "missingApiKey" as const;
  }
  return overHourlyLimit(database, running) ? ("rateLimited" as const) : null;
}

/** The assistant's turn on the run's latest message, as `runTurn` (`assistant.ts`) runs it. */
async function playTurn(run: SandboxRun, model: AssistantModel) {
  const { database } = run;
  const { conversationId } = run.state;
  const { read, appointments, answered } = run.step(() => {
    const read = readConversation(database, conversationId);
    const appointments = upcomingAppointments(database, read.phone, Date.now());
    const answered = answeredMessage(database, conversationId, read.unjudged);
    return { read, appointments, answered };
  });
  const turn = { conversationId, read, appointments: [...appointments] };
  const judged = await judgeTurn(database, model, turn, run.mode);
  const shown = { toolCalls: run.toolCalls, judgement: judged?.judgement ?? null };
  if (!judged) {
    return { ...shown, outcome: "unread" as const, held: null, replies: [] };
  }
  const { settled, practitioner, changed, toReception } = run.step(() =>
    settleTurn(database, { conversationId, appointments, answered, ...judged, read }),
  );
  const said = !says(settled)
    ? none
    : await sandboxReply(run, model, {
        ...judged,
        settled,
        practitioner,
        changed,
        toReception,
        answered,
        patients: read.patients.map((one) => one.firstName),
      });
  for (const text of said.replies) {
    run.append("outgoing", text);
  }
  return { ...shown, outcome: settled, ...said };
}

type Answered = ReturnType<typeof answeredMessage>;

/** Nothing said and nothing held. */
const none = { held: null, replies: [] };

/**
 * What the patient would be told, as `deliverReply` (`turn-replies.ts`) tells
 * them but sending nothing: the fixed reply, or the model's once the clinical
 * and code checks pass it; a reply they flag is held, with the check that held it.
 */
async function sandboxReply(
  run: SandboxRun,
  model: AssistantModel,
  turn: Parameters<typeof replyTexts>[0] & {
    changed: boolean;
    toReception: boolean;
    answered: Answered;
    patients: string[];
    proposed: boolean;
  },
) {
  const { conversationId } = run.state;
  const texts = replyTexts(turn);
  if (!texts) {
    return none;
  }
  const whole = { whole: turn.proposed };
  if (texts.fixed) {
    const first = repliesFirst(turn) ? await checkedModelReply(run, model, turn) : none;
    return { held: first.held, replies: [...first.replies, ...splitReply(texts.text, whole)] };
  }
  const request = { conversationId, reply: texts.text, patients: turn.patients };
  const because = await checkThatHolds(run.database, model, request, turn, true);
  if (!because) {
    return { held: null, replies: splitReply(texts.text, whole) };
  }
  const held = { conversationId, answered: turn.answered, words: texts.text, because };
  const shown = { text: texts.text, because };
  if (because !== "clinical") {
    run.step(() => holdForReception(run.database, held));
    return { held: shown, replies: [] };
  }
  const opened = run.step(() => openHeldReply(run.database, held));
  const text = opened && handoffReplyText(turn.rules, opened.practitioner);
  return { held: shown, replies: text ? splitReply(text, { whole: false }) : [] };
}

/**
 * The model's reply that goes before a fixed one, as `deliverReply` sends it:
 * once the fixed checks and the clinical and code checks pass it, else none,
 * and held when the code checks hold it.
 */
async function checkedModelReply(
  run: SandboxRun,
  model: AssistantModel,
  turn: { reply: string; patients: string[]; proposed: boolean; answered: Answered },
) {
  const checked = checkReply(turn.reply);
  if (!checked.ok) {
    return none;
  }
  const request = {
    conversationId: run.state.conversationId,
    reply: checked.text,
    patients: turn.patients,
  };
  const because = await checkThatHolds(run.database, model, request, {}, true);
  if (because && because !== "clinical") {
    const held = { ...request, answered: turn.answered, words: checked.text, because };
    run.step(() => holdForReception(run.database, held));
    return { held: { text: checked.text, because }, replies: [] };
  }
  return because
    ? none
    : { held: null, replies: splitReply(checked.text, { whole: turn.proposed }) };
}

/** The turn's answer: the conversation to carry on, its window's close, and what the turn did. */
function answer<T>(run: SandboxRun, turn: T) {
  const incoming = run.state.messages.filter((message) => message.direction === "incoming");
  return {
    ok: true,
    sandbox: run.state,
    windowClosesAt: windowClosesAt(incoming.at(-1)?.sentAt ?? null),
    turn,
  } as const;
}
