import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";

import {
  isFull,
  sandboxModelCallsPerHour,
  sandboxStartSchema,
  sandboxTurnSchema,
} from "#/lib/assistant-sandbox.ts";
import type { SandboxStart, SandboxState, SandboxTurnInput } from "#/lib/assistant-sandbox.ts";
import { windowClosesAt } from "#/lib/conversation-window.ts";
import { phoneSpellings } from "#/lib/phones.ts";
import { splitReply } from "#/lib/reply-pacing.ts";
import { fillTemplate, templateValues } from "#/lib/template-filling.ts";

import { judgeTurn, readConversation, settleTurn } from "#/organization/assistant.ts";
import type { TurnMode } from "#/organization/assistant.ts";
import { upcomingAppointments } from "#/organization/assistant-appointments.ts";
import { maxModelCalls } from "#/organization/assistant-model.ts";
import type { AssistantModel, AssistantTool } from "#/organization/assistant-model.ts";
import type { Database } from "#/organization/database.ts";
import { organizationName } from "#/organization/members.ts";
import { answeredMessage } from "#/organization/handoffs.ts";
import { upcomingStatuses } from "#/organization/template-messages.ts";
import { applyChange } from "#/organization/proposals.ts";
import {
  appointment,
  guardian,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import {
  clinicalCheckHolds,
  handoffReplyText,
  openHeldReply,
  replyTexts,
  says,
} from "#/organization/turn-replies.ts";
import {
  conversation,
  handoff,
  medicalServiceTemplate,
  modelUsage,
  outboxMessage,
  proposal,
  template,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { approvedVersion } from "#/organization/whatsapp-templates.ts";

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

/** The scenarios to start from: the upcoming appointments, soonest first, this many. */
const scenarioCount = 50;

/** The appointment and the patient a scenario starts from, with the number that reaches them. */
function scenarioRows(database: Database) {
  return database
    .select({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      firstName: patient.firstName,
      lastName: patient.lastName,
      chosenName: patient.chosenName,
      phone: patient.phone,
      guardianPhone: guardian.phone,
      practitionerName: practitioner.displayName,
      officeName: office.name,
      officeAddress: office.address,
      timeZone: office.timeZone,
      medicalServiceId: appointment.medicalServiceId,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .leftJoin(guardian, and(eq(guardian.patientId, patient.id), eq(guardian.messageContact, true)))
    .$dynamic();
}

/** An appointment a scenario can start from or go on with: booked or confirmed, and not begun. */
function isUpcoming() {
  return and(inArray(appointment.status, upcomingStatuses), gt(appointment.startsAt, Date.now()));
}

/** The upcoming appointment `appointmentId` with the number its patient is reached at, or `null`. */
function scenarioOf(database: Database, appointmentId: string) {
  const found = scenarioRows(database)
    .where(and(eq(appointment.id, appointmentId), isUpcoming()))
    .get();
  const phone = found && (found.guardianPhone ?? found.phone);
  return found && phone ? { ...found, phone } : null;
}

/** The upcoming appointments a sandbox can start from: those whose patient WhatsApp reaches. */
export function listSandboxScenarios(database: Database) {
  const rows = scenarioRows(database)
    .where(and(inArray(appointment.status, upcomingStatuses), gt(appointment.startsAt, Date.now())))
    .orderBy(asc(appointment.startsAt), asc(appointment.id))
    .limit(scenarioCount)
    .all();
  return {
    ok: true as const,
    scenarios: rows
      .filter((row) => (row.guardianPhone ?? row.phone) !== null)
      .map((row) => ({
        appointmentId: row.appointmentId,
        startsAt: row.startsAt,
        timeZone: row.timeZone,
        patient: `${row.chosenName ?? row.firstName} ${row.lastName}`,
        practitioner: row.practitionerName,
      })),
  };
}

/** What the sandbox's reminder says when the organization has no template timed before an appointment. */
const fallbackReminder =
  "Hola {{paciente}}, te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Respondé este mensaje para confirmar que venís.";

/**
 * The template the scenario's reminder is: the furthest before the
 * appointment its medical service picks, else the organization's furthest;
 * `null` when it has none timed before an appointment.
 */
function reminderTemplate(database: Database, medicalServiceId: string) {
  const timedBefore = database
    .select({ id: template.id, draft: template.draft, picked: medicalServiceTemplate.templateId })
    .from(template)
    .leftJoin(
      medicalServiceTemplate,
      and(
        eq(medicalServiceTemplate.templateId, template.id),
        eq(medicalServiceTemplate.medicalServiceId, medicalServiceId),
      ),
    )
    .where(eq(template.timing, "before"))
    .orderBy(desc(template.timingHours))
    .all();
  return timedBefore.find((one) => one.picked !== null) ?? timedBefore[0] ?? null;
}

/** The reminder the scenario starts from, as the patient read it: the approved template, or its draft. */
function reminderOf(database: Database, scenario: NonNullable<ReturnType<typeof scenarioOf>>) {
  const reminder = reminderTemplate(database, scenario.medicalServiceId);
  const body =
    (reminder && (approvedVersion(database, reminder.id)?.body ?? reminder.draft)) ??
    fallbackReminder;
  const values = templateValues({
    patient: scenario,
    practitionerName: scenario.practitionerName,
    start: new Date(scenario.startsAt),
    timeZone: scenario.timeZone,
    officeName: scenario.officeName,
    officeAddress: scenario.officeAddress,
    organizationName: organizationName(database),
  });
  return { templateId: reminder?.id ?? null, text: fillTemplate(body.trim(), values).text };
}

/** A sandbox conversation for `appointmentId`, its reminder just sent. */
export function startSandbox(database: Database, input: SandboxStart) {
  const parsed = sandboxStartSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const scenario = scenarioOf(database, parsed.data.appointmentId);
  if (!scenario) {
    return { ok: false, reason: "notFound" } as const;
  }
  const sandbox: SandboxState = {
    conversationId: crypto.randomUUID(),
    appointmentId: scenario.appointmentId,
    messages: [
      {
        direction: "outgoing",
        text: reminderOf(database, scenario).text,
        sentAt: Date.now(),
        judgement: null,
      },
    ],
    misunderstandings: 0,
    proposals: [],
    handoffs: [],
  };
  return { ok: true, sandbox } as const;
}

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
    .get()!;
  return calls + running.count * callsPerTurn >= sandboxModelCallsPerHour;
}

class Rollback extends Error {}

/** A tool call of a sandbox turn, as JSON: what the model asked, and what the object returned. */
interface ToolCall {
  name: AssistantTool["name"];
  args: string;
  result: string;
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
    const kept: { result?: T; state?: SandboxState } = {};
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
    this.state = kept.state!;
    return kept.result as T;
  }

  /** Appends a message, after the last one: a turn's replies follow its patient's message. */
  append(direction: "incoming" | "outgoing", text: string) {
    const last = this.state.messages.at(-1)!;
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
    database
      .insert(whatsappMessage)
      .values(
        state.messages.map((message, index) => ({
          ...message,
          id: this.#messageId(index),
          conversationId,
          whatsappId: `sandbox.${this.#messageId(index)}`,
          type: "text",
          payload: "{}",
        })),
      )
      .run();
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
          dueAt: state.messages[0]!.sentAt,
          whatsappMessageId: this.#messageId(0),
        })
        .run();
    }
    // The sandbox's own changes hold in its later steps: made again, by the same
    // functions, whose rules run again. One they refuse now (its new time was
    // booked meanwhile, its cutoff passed, reception confirmed it for real) is
    // no longer accepted (#257).
    const accepted = state.proposals.filter((kept) => kept.acceptedAt !== null);
    const stillMade = new Set(
      accepted
        .sort((a, b) => a.acceptedAt! - b.acceptedAt!)
        .filter(
          (kept) =>
            applyChange(database, { ...kept, conversationId, updatedAt: kept.createdAt }).ok,
        )
        .map((kept) => kept.id),
    );
    for (const kept of state.proposals) {
      const acceptedAt = stillMade.has(kept.id) ? kept.acceptedAt : null;
      database
        .insert(proposal)
        .values({ ...kept, acceptedAt, conversationId })
        .run();
    }
    for (const kept of state.handoffs) {
      database
        .insert(handoff)
        .values({ ...kept, conversationId })
        .run();
    }
  }

  /** What the open transaction holds of the sandbox conversation. */
  #readBack(): SandboxState {
    const { database, state } = this;
    const { conversationId } = state;
    const { misunderstandings } = database
      .select({ misunderstandings: conversation.misunderstandings })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get()!;
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
        startsAt: proposal.startsAt,
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
 * judgement, what the patient would be told, and the reply the clinical check
 * would hold.
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
    const patientIds = read.patients.map((one) => one.id);
    const appointments = upcomingAppointments(database, patientIds, Date.now());
    const answered = answeredMessage(database, conversationId, read.unjudged[0]!.sentAt);
    return { read, appointments, answered };
  });
  const turn = { conversationId, read, appointments: [...appointments] };
  const judged = await judgeTurn(database, model, turn, run.mode);
  const shown = { toolCalls: run.toolCalls, judgement: judged?.judgement ?? null };
  if (!judged) {
    return { ...shown, outcome: "unread" as const, held: null, replies: [] };
  }
  const { settled, practitioner } = run.step(() =>
    settleTurn(database, { conversationId, appointments, answered, ...judged, read }),
  );
  const said = !says(settled)
    ? { held: null, replies: [] }
    : await sandboxReply(run, model, {
        ...judged,
        settled,
        practitioner,
        answered,
        patients: read.patients.map((one) => one.firstName),
      });
  for (const text of said.replies) {
    run.append("outgoing", text);
  }
  return { ...shown, outcome: settled, ...said };
}

/**
 * What the patient would be told, as `deliverReply` (`turn-replies.ts`) tells
 * them but sending nothing: the fixed reply, or the model's once the clinical
 * check passes it; a reply it flags is held on a handoff to the practitioner.
 */
async function sandboxReply(
  run: SandboxRun,
  model: AssistantModel,
  turn: Parameters<typeof replyTexts>[0] & {
    answered: ReturnType<typeof answeredMessage>;
    patients: string[];
    proposed: boolean;
  },
) {
  const { conversationId } = run.state;
  const texts = replyTexts(turn);
  if (!texts) {
    return { held: null, replies: [] };
  }
  const whole = { whole: turn.proposed };
  if (texts.fixed) {
    return { held: null, replies: splitReply(texts.text, whole) };
  }
  const request = { conversationId, reply: texts.text, patients: turn.patients };
  if (!(await clinicalCheckHolds(run.database, model, request, true))) {
    return { held: null, replies: splitReply(texts.text, whole) };
  }
  const opened = run.step(() =>
    openHeldReply(run.database, { conversationId, answered: turn.answered, words: texts.text }),
  );
  const text = opened && handoffReplyText(turn.rules, opened.practitioner);
  return {
    held: texts.text,
    replies: text ? splitReply(text, { whole: false }) : [],
  };
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
