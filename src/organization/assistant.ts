import { and, asc, eq, isNotNull, lte, min, or } from "drizzle-orm";

import { isOneOf } from "#/lib/is-one-of.ts";
import { present } from "#/lib/present.ts";
import type { HandoffDetail } from "#/lib/handoffs.ts";
import { mediaTypes } from "#/lib/whatsapp-messages.ts";
import { reactionType } from "#/lib/reactions.ts";
import type { MediaType } from "#/lib/whatsapp-messages.ts";
import { assistantSystemPrompt, assistantToolSchemas } from "#/lib/assistant.ts";

import { bookableMedicalServices } from "#/organization/assistant-information.ts";
import { upcomingAppointments, whenOf } from "#/organization/assistant-appointments.ts";
import { findBookingTimes } from "#/organization/booking-times.ts";
import type { Upcoming } from "#/organization/assistant-appointments.ts";
import type { AssistantModel, AssistantTool, ToolResult } from "#/organization/assistant-model.ts";
import { recordModelUsage } from "#/organization/assistant-usage.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";
import { answeredMessage, openHandoffsOf } from "#/organization/handoffs.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { proposalTools } from "#/organization/proposals.ts";
import { reactionsOf } from "#/organization/reactions.ts";
import { answerTap } from "#/organization/button-taps.ts";
import { asTurnMessages, patientsOf, readConversation } from "#/organization/turn-reading.ts";
import type { TurnRead } from "#/organization/turn-reading.ts";
import {
  answeredMeanwhile,
  clearFailedTurns,
  retryOrHandOff,
  turnForTheRest,
} from "#/organization/turn-retries.ts";
import type { HandOffCall, Judgement } from "#/organization/turn-handoffs.ts";
import type { Transcriber } from "#/organization/transcription.ts";
import {
  allUnintelligible,
  transcribeVoiceNotes,
  unintelligibleTurn,
} from "#/organization/voice-notes.ts";
import { deliverReply, maySend, says } from "#/organization/turn-replies.ts";
import { settleTurn } from "#/organization/turn-settling.ts";
import { claimTurn, releaseTurn, settleLostTurn } from "#/organization/turn-claims.ts";
import { organizationName } from "#/organization/members.ts";
import { office } from "#/organization/schema.ts";
import { conversation } from "#/organization/whatsapp-schema.ts";
import type { Job, JobServices } from "#/organization/jobs.ts";

// The patient assistant (docs/domain/assistant.md § For patients, ADR-0006):
// the object's alarm runs a turn once a conversation's wait is over. The
// model interprets, underthing decides: the model's tools read only what the
// conversation's number may know, nothing clinical; the model judges each
// new patient message, whether it needs the practitioner; and the code here
// settles the turn, whose reply `turn-replies.ts` sends when underthing
// allows it. The assistant keeps answering while a handoff is open, told
// what it is about so it leaves that topic to the person. A photo or a file
// never reaches the model, and goes to reception; a voice note reaches it as
// its transcript (`voice-notes.ts`), and one nobody could understand does
// not reach it. Nothing here logs a patient's words or data.

/**
 * When the next turn is due, or a running turn's claim lapses; `null` when
 * neither waits or the model cannot run.
 */
function nextTurnAlarm(database: Database, { assistant }: JobServices): number | null {
  if (assistant.missingSetting()) {
    return null;
  }
  const next = database
    .select({
      dueAt: min(conversation.assistantDueAt),
      lapsesAt: min(conversation.turnClaimedUntil),
    })
    .from(conversation)
    .get();
  const times = [next?.dueAt ?? null, next?.lapsesAt ?? null].filter((at) => at !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

/** What the model recorded in a turn through its tools. */
interface Recorded {
  judgement: Judgement | null;
  handOff: HandOffCall | null;
  /** The appointment a rule kept the patient from moving, which underthing hands off. */
  ruleRefused: string | null;
  /** Why, as the handoff's notification says it. */
  refusal: HandoffDetail["refused"];
  /** The medical service find_booking_times refused to book, which underthing hands off. */
  bookingUnavailable: string | null;
  /** The changes the turn's accepted proposals made. */
  applied: HandoffDetail["applied"];
  /** The model stored a proposal, which its reply states. */
  proposed: boolean;
}

/**
 * The turn's tools, run with the permissions of the conversation's number:
 * they see only the patients it is the message contact of, and their
 * upcoming appointments, which they change only through a proposal
 * (`proposals.ts`). The judgement and the handoff the model records land in
 * `recorded`.
 */
function turnTools(
  database: Database,
  turn: { conversationId: string; read: TurnRead; appointments: Upcoming[] },
  recorded: Recorded,
): AssistantTool[] {
  const { patients } = turn.read;
  const { appointments } = turn;
  return [
    {
      name: "list_patients",
      run: () => ({
        patients: patients.map((one) => ({
          patientId: one.id,
          firstName: one.firstName,
          upcomingAppointments: appointments
            .filter((upcoming) => upcoming.patientId === one.id)
            .map((upcoming) => ({
              appointmentId: upcoming.id,
              ...whenOf(upcoming),
              status: upcoming.status,
              medicalService: upcoming.medicalService,
              specialty: upcoming.specialty,
            })),
        })),
      }),
    },
    {
      name: "get_appointment",
      run: (args) => {
        const parsed = assistantToolSchemas.get_appointment.inputSchema.safeParse(args);
        const found =
          parsed.success &&
          appointments.find((upcoming) => upcoming.id === parsed.data.appointmentId);
        if (!found) {
          return { ok: false, reason: "notFound" };
        }
        return {
          ok: true,
          appointment: {
            medicalService: found.medicalService,
            practitioner: found.practitioner,
            ...whenOf(found),
            address: found.address,
          },
        };
      },
    },
    {
      name: "list_medical_services",
      run: () => ({ medicalServices: bookableMedicalServices(database) }),
    },
    {
      name: "find_booking_times",
      run: (args) => {
        const found = findBookingTimes(database, args);
        const asked = assistantToolSchemas.find_booking_times.inputSchema.safeParse(args);
        // A practitioner named who does not offer it is no reason: the practice may.
        const unbookable =
          !found.ok &&
          found.reason !== "invalidInput" &&
          !(found.reason === "notFound" && asked.data?.practitioner !== undefined);
        if (found.ok) {
          recorded.bookingUnavailable = null;
        } else if (unbookable && asked.success) {
          recorded.bookingUnavailable = asked.data.medicalService;
        }
        return found;
      },
    },
    {
      name: "judge_messages",
      run: (args) => {
        const parsed = assistantToolSchemas.judge_messages.inputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, reason: "invalidInput" };
        }
        // An emergency always needs a practitioner, whatever the model said of it.
        const { healthQuestion, emergency } = parsed.data;
        recorded.judgement = { ...parsed.data, healthQuestion: healthQuestion || emergency };
        return { ok: true };
      },
    },
    {
      name: "hand_off",
      run: (args) => {
        const parsed = assistantToolSchemas.hand_off.inputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, reason: "invalidInput" };
        }
        recorded.handOff = parsed.data;
        return { ok: true };
      },
    },
    ...proposalTools(database, { ...turn, recorded }),
  ];
}

/**
 * How a turn runs: for patients, or in the sandbox (`assistant-sandbox.ts`),
 * which runs each tool through `step`, inside a transaction it rolls back,
 * and records its model runs as sandbox use.
 */
export interface TurnMode {
  sandbox: boolean;
  step(name: AssistantTool["name"], args: unknown, run: () => ToolResult): ToolResult;
}

const forPatients: TurnMode = { sandbox: false, step: (_name, _args, run) => run() };

/** The organization's name and the address of its office. */
function promptSetting(database: Database) {
  const practice = present(
    database.select({ address: office.address }).from(office).get(),
    "The organization's setup created its office",
  );
  return { organizationName: organizationName(database), address: practice.address };
}

/**
 * Runs the model on the conversation: its reply, judgement and hand_off, or
 * `null` when it judged nothing or could not run.
 */
export async function judgeTurn(
  database: Database,
  model: AssistantModel,
  turn: { conversationId: string; read: TurnRead; appointments: Upcoming[] },
  mode: TurnMode,
) {
  const rules = currentCommunicationRules(database);
  const recorded: Recorded = {
    judgement: null,
    handOff: null,
    ruleRefused: null,
    refusal: null,
    bookingUnavailable: null,
    applied: [],
    proposed: false,
  };
  const system = assistantSystemPrompt({
    ...promptSetting(database),
    now: new Date(),
    formOfAddress: rules.formOfAddress,
    tone: rules.tone,
    openHandoffs: openHandoffsOf(database, turn.conversationId).map((open) => open.reason),
  });
  const ran = await model
    .runTurn({
      conversationId: turn.conversationId,
      system,
      messages: asTurnMessages(turn.read),
      tools: turnTools(database, turn, recorded).map((tool) => ({
        name: tool.name,
        run: (args) => mode.step(tool.name, args, () => tool.run(args)),
      })),
      recordUsage: (used) =>
        recordModelUsage(database, { ...used, purpose: "turn", sandbox: mode.sandbox }),
    })
    // The model is unavailable: the messages wait, unjudged, for their retry.
    .catch(() => null);
  const { judgement } = recorded;
  if (!ran || !judgement) {
    return null;
  }
  // An emergency the model handed off is one, whatever it judged: its reply and alert go.
  const handedOffEmergency = recorded.handOff?.reason === "emergency";
  return {
    reply: ran.reply,
    judgement: handedOffEmergency
      ? { ...judgement, emergency: true, healthQuestion: true }
      : judgement,
    handOff: recorded.handOff,
    ruleRefused: recorded.ruleRefused,
    refusal: recorded.refusal,
    bookingUnavailable: recorded.bookingUnavailable,
    applied: recorded.applied,
    proposed: recorded.proposed,
    rules,
  };
}

/**
 * Whether the model's reply may go now: no newer message waits for its own
 * turn, the contacts and the appointments it read are as they were, and the
 * number may send.
 */
function mayReply(
  database: Database,
  cloud: WhatsappCloud,
  turn: { conversationId: string; read: TurnRead; appointments: Upcoming[] },
) {
  const now = Date.now();
  const newerWaits = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, turn.conversationId), isNotNull(conversation.assistantDueAt)))
    .get();
  const patients = patientsOf(database, turn.read.phone);
  const unchanged =
    JSON.stringify(patients) === JSON.stringify(turn.read.patients) &&
    JSON.stringify(upcomingAppointments(database, turn.read.phone, now)) ===
      JSON.stringify(turn.appointments);
  return !newerWaits && unchanged && maySend(database, cloud, turn.conversationId);
}

/**
 * The conversation as its turn judges it, once the voice notes among its
 * messages are transcribed, or `null` when no message waits. Only the messages
 * waiting when the turn began are judged: one that arrives while a note is
 * transcribed waits for its own turn, which its arrival set.
 */
async function readTranscribed(
  database: Database,
  cloud: WhatsappCloud,
  transcriber: Transcriber,
  conversationId: string,
) {
  const waiting = readConversation(database, conversationId).unjudged.map((message) => message.id);
  if (waiting.length === 0) {
    return null;
  }
  const transcribed = await transcribeVoiceNotes(database, cloud, transcriber, waiting);
  const read = readConversation(database, conversationId);
  const unjudged = read.unjudged.filter((message) => waiting.includes(message.id));
  return unjudged.length > 0 ? { ...read, unjudged, transcribed } : null;
}

/**
 * Runs the turn of `conversationId` once it is claimed (`turn-claims.ts`),
 * releasing the claim once it settles: a turn its alarm lost before that
 * is settled from its lapsed claim.
 */
async function claimAndRunTurn(
  database: Database,
  cloud: WhatsappCloud,
  ports: { model: AssistantModel; transcriber: Transcriber },
  conversationId: string,
): Promise<(() => Promise<void>) | null> {
  settleLostTurn(database, conversationId);
  if (!claimTurn(database, conversationId)) {
    return null;
  }
  const delivery = await runTurn(database, cloud, ports, conversationId);
  releaseTurn(database, conversationId);
  return delivery;
}

/**
 * Runs the claimed turn of `conversationId`: judges the patient's new
 * messages and settles them, and returns the delivery of its reply, which
 * sends it when underthing allows it, or `null` when the turn says nothing.
 */
async function runTurn(
  database: Database,
  cloud: WhatsappCloud,
  ports: { model: AssistantModel; transcriber: Transcriber },
  conversationId: string,
): Promise<(() => Promise<void>) | null> {
  const { model } = ports;
  const read = await readTranscribed(database, cloud, ports.transcriber, conversationId);
  if (!read) {
    // Nothing waits, as once the patient took back the only reaction a failed turn left.
    clearFailedTurns(database, conversationId);
    return null;
  }
  const tap = answerTap(database, cloud, { conversationId, ...read });
  if (tap) {
    clearFailedTurns(database, conversationId);
    return tap.deliver;
  }
  const { transcribed } = read;
  const appointments = upcomingAppointments(database, read.phone, Date.now());
  // The turn's own view of them, which a proposal it accepts changes: its
  // reply is checked against the state its own change left.
  const view = [...appointments];
  const answered = answeredMessage(database, conversationId, read.unjudged);
  const media = read.unjudged.filter((message) => isOneOf(mediaTypes, message.type));
  const startedAt = Date.now();
  const { turn, unread } = await judgeWithoutMedia(database, model, {
    conversationId,
    read,
    appointments: view,
    media,
    transcribed,
  });
  if (unread.length > 0) {
    const appointmentId = answered?.appointmentId ?? null;
    retryOrHandOff(database, { conversationId, messageIds: unread, appointmentId, startedAt });
  } else {
    clearFailedTurns(database, conversationId);
  }
  if (!turn) {
    return null;
  }
  // A person answered the turn's messages while the model read them: theirs is the answer.
  // A reaction the patient replaced or took back meanwhile was judged by that, not by a
  // person (`whatsapp-messages.ts`); one still shown was judged by a person.
  const { live } = reactionsOf(database, conversationId);
  const answerable = turn.read.unjudged.filter(
    (message) => message.type !== reactionType || live.has(message.id),
  );
  if (
    answeredMeanwhile(
      database,
      answerable.map((message) => message.id),
    )
  ) {
    turnForTheRest(database, conversationId);
    return null;
  }
  const { settled, practitioner, changed, toReception } = settleTurn(database, {
    conversationId,
    appointments,
    answered,
    ...turn,
  });
  // A photo's handoff is settled, but the patient hears nothing while their text is unread.
  if (!says(settled) || unread.length > 0) {
    return null;
  }
  const replying = { conversationId, read, appointments: view };
  return () =>
    deliverReply(database, cloud, model, {
      conversationId,
      phone: read.phone,
      patients: read.patients.map((one) => one.firstName),
      answered,
      settled,
      practitioner,
      changed,
      toReception,
      reply: turn.reply,
      rules: turn.rules,
      proposed: turn.proposed,
      mayReply: () => mayReply(database, cloud, replying),
    });
}

function mediaKindsOf(messages: { type: string }[]): MediaType[] {
  return [...new Set(messages.map((message) => message.type as MediaType))];
}

/**
 * Judges the turn's messages but the photos and files among them, which the
 * model never reads: they are handed to reception (`turn-handoffs.ts`). With
 * nothing else to judge the model does not run, nor with only voice notes
 * nobody could understand. `unread` lists the rest when the model could not
 * judge them, or a voice note among them has no transcript yet: they wait for
 * the retry (`turn-retries.ts`).
 */
async function judgeWithoutMedia(
  database: Database,
  model: AssistantModel,
  turn: {
    conversationId: string;
    read: TurnRead;
    appointments: Upcoming[];
    media: TurnRead["unjudged"];
    /** Every voice note among the messages has its transcript. */
    transcribed: boolean;
  },
) {
  const { read, media } = turn;
  const unjudged = read.unjudged.filter((message) => !media.includes(message));
  let judged: Awaited<ReturnType<typeof judgeTurn>> | ReturnType<typeof unintelligibleTurn> = null;
  if (unjudged.length > 0 && turn.transcribed) {
    judged = allUnintelligible(unjudged)
      ? unintelligibleTurn(currentCommunicationRules(database))
      : await judgeTurn(database, model, { ...turn, read: { ...read, unjudged } }, forPatients);
  }
  const unread = judged ? [] : unjudged.map((message) => message.id);
  if (media.length === 0) {
    return { turn: judged && { ...judged, read }, unread };
  }
  if (!judged) {
    // Only the media is judged now: the rest waits for the model.
    const judgement = {
      healthQuestion: false,
      emergency: false,
      understood: true,
      optOut: false,
      booking: false,
    };
    const rules = currentCommunicationRules(database);
    const nothingElse = {
      ...{ reply: "", handOff: null, ruleRefused: null, refusal: null, applied: [] },
      bookingUnavailable: null,
      ...{ proposed: false, rules },
    };
    const onlyMedia = {
      ...nothingElse,
      judgement,
      media: mediaKindsOf(media),
      read: { ...read, unjudged: media },
    };
    return { turn: onlyMedia, unread };
  }
  return { turn: { ...judged, media: mediaKindsOf(media), read }, unread };
}

/**
 * Runs every turn whose wait is over, earliest first: the object's alarm.
 * The turns are judged one at a time, but each reply is delivered alongside
 * the turns after it, so a conversation's turn does not wait for another's
 * clinical check and typing pauses (docs/domain/assistant.md § Pace). The
 * alarm ends once every reply is delivered, and fails as the first
 * delivery that failed.
 */
async function runDueTurns(database: Database, services: JobServices) {
  const cloud = services.whatsapp;
  const ports = { model: services.assistant, transcriber: services.transcriber };
  if (ports.model.missingSetting()) {
    return;
  }
  const now = Date.now();
  const due = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(or(lte(conversation.assistantDueAt, now), lte(conversation.turnClaimedUntil, now)))
    .orderBy(asc(conversation.assistantDueAt))
    .all();
  const deliveries: Promise<void>[] = [];
  const failures: unknown[] = [];
  try {
    for (const { id } of due) {
      const deliver = await claimAndRunTurn(database, cloud, ports, id);
      if (deliver) {
        deliveries.push(deliver().catch((error: unknown) => void failures.push(error)));
      }
    }
  } finally {
    await Promise.all(deliveries);
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}

export const assistantTurnsJob: Job = {
  name: "assistant turns",
  nextDue: nextTurnAlarm,
  run: runDueTurns,
};
