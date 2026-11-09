import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, min } from "drizzle-orm";

import { defaultTimeZone } from "#/lib/offices.ts";
import { assistantSystemPrompt, assistantToolSchemas, withSignOff } from "#/lib/assistant.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { templateValues } from "#/lib/template-filling.ts";

import type { AssistantModel, AssistantTool, TurnMessage } from "#/organization/assistant-model.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { upcomingStatuses } from "#/organization/outbox.ts";
import {
  appointment,
  medicalService,
  office,
  organization,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import {
  conversation,
  conversationPatient,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { storeOutgoing, whileSending } from "#/organization/whatsapp-messages.ts";

// The patient assistant (docs/domain/assistant.md § For patients, ADR-0006):
// the object's alarm runs a turn once a conversation's wait is over. The
// model interprets, underthing decides: the model's tools read only what the
// conversation's number may know, nothing clinical; the model judges each
// new patient message; and the code here decides whether its reply goes out
// (an appointment to talk about, nothing clinical, the window open, the fixed
// checks passed). Nothing here logs a patient's words or data.

/** The conversation history a turn reads, newest messages last. */
const historyLength = 30;

/** When the next turn is due, or `null` when none waits or the model cannot run. */
export function nextTurnAlarm(database: Database, model: AssistantModel): number | null {
  if (model.missingSetting()) {
    return null;
  }
  const next = database
    .select({ dueAt: min(conversation.assistantDueAt) })
    .from(conversation)
    .get();
  return next?.dueAt ?? null;
}

/** The upcoming appointments of `patientIds`, with what the patient may be told of each. */
function upcomingAppointments(database: Database, patientIds: string[], now: number) {
  if (patientIds.length === 0) {
    return [];
  }
  return database
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      medicalService: medicalService.name,
      practitioner: practitioner.displayName,
      office: office.name,
      address: office.address,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        inArray(appointment.patientId, patientIds),
        inArray(appointment.status, upcomingStatuses),
        gt(appointment.startsAt, now),
      ),
    )
    .orderBy(asc(appointment.startsAt))
    .all();
}

type Upcoming = ReturnType<typeof upcomingAppointments>[number];

/** The day and the time of `upcoming` as the templates write them, in its office's zone. */
function whenOf(upcoming: Upcoming) {
  const values = templateValues({
    patient: { firstName: "", chosenName: null },
    practitionerName: upcoming.practitioner,
    start: new Date(upcoming.startsAt),
    timeZone: upcoming.timeZone,
    officeName: upcoming.office,
    officeAddress: upcoming.address,
    careInstructions: null,
  });
  return { date: values.fecha, time: values.hora };
}

type Judgement = { clinical: boolean; emergency: boolean };

/**
 * The turn's tools, run with the permissions of the conversation's number:
 * they see only the patients it is the message contact of, and their
 * upcoming appointments. The judgement the model records lands in `judged`.
 */
function turnTools(
  patients: { id: string; firstName: string }[],
  appointments: Upcoming[],
  judged: { judgement: Judgement | null },
): AssistantTool[] {
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
            office: found.office,
            address: found.address,
          },
        };
      },
    },
    {
      name: "judge_messages",
      run: (args) => {
        const parsed = assistantToolSchemas.judge_messages.inputSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, reason: "invalidInput" };
        }
        judged.judgement = parsed.data;
        return { ok: true };
      },
    },
  ];
}

/** The conversation as a turn reads it: its number, its patients, its recent messages. */
function readConversation(database: Database, conversationId: string) {
  const { phone } = database
    .select({ phone: conversation.phone })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get()!;
  const patients = database
    .select({ id: patient.id, firstName: patient.firstName, chosenName: patient.chosenName })
    .from(conversationPatient)
    .innerJoin(patient, eq(patient.id, conversationPatient.patientId))
    .where(eq(conversationPatient.conversationId, conversationId))
    .all()
    .map((one) => ({ id: one.id, firstName: one.chosenName ?? one.firstName }));
  const recent = database
    .select({
      id: whatsappMessage.id,
      direction: whatsappMessage.direction,
      type: whatsappMessage.type,
      text: whatsappMessage.text,
      judgement: whatsappMessage.judgement,
    })
    .from(whatsappMessage)
    .where(eq(whatsappMessage.conversationId, conversationId))
    .orderBy(desc(whatsappMessage.sentAt))
    .limit(historyLength)
    .all()
    .reverse();
  const lastIncoming = database
    .select({ at: max(whatsappMessage.sentAt) })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
      ),
    )
    .get();
  return { phone, patients, recent, lastIncomingAt: lastIncoming?.at ?? null };
}

/** The messages as the model reads them: one per run of the same side, as WhatsApp shows a burst. */
function asTurnMessages(recent: ReturnType<typeof readConversation>["recent"]): TurnMessage[] {
  const messages: TurnMessage[] = [];
  for (const message of recent) {
    const role = message.direction === "incoming" ? "user" : "assistant";
    const content = message.text ?? `[${message.type}]`;
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }
  return messages;
}

/** The organization's name, and the zone its first office reads time in. */
function promptSetting(database: Database) {
  const { name } = database.select({ name: organization.name }).from(organization).get()!;
  const first = database
    .select({ timeZone: office.timeZone })
    .from(office)
    .orderBy(asc(office.createdAt))
    .get();
  return { organizationName: name, timeZone: first?.timeZone ?? defaultTimeZone };
}

type Read = ReturnType<typeof readConversation>;

/**
 * Runs the model on the conversation and stores its judgement on the
 * messages `unjudged`: its reply, or `null` when it judged nothing or could
 * not run. A message that arrived meanwhile is left for the next turn.
 */
async function judgeTurn(
  database: Database,
  model: AssistantModel,
  turn: { conversationId: string; read: Read; unjudged: string[]; appointments: Upcoming[] },
) {
  const rules = currentCommunicationRules(database);
  const judged: { judgement: Judgement | null } = { judgement: null };
  const system = assistantSystemPrompt({
    ...promptSetting(database),
    now: new Date(),
    formOfAddress: rules.formOfAddress,
    tone: rules.tone,
  });
  const ran = await model
    .runTurn({
      conversationId: turn.conversationId,
      system,
      messages: asTurnMessages(turn.read.recent),
      tools: turnTools(turn.read.patients, turn.appointments, judged),
    })
    // The model is unavailable: the messages wait, unjudged, for #179's retry.
    .catch(() => null);
  const { judgement } = judged;
  if (!ran || !judgement) {
    return null;
  }
  database
    .update(whatsappMessage)
    .set({
      judgement: judgement.clinical ? "clinical" : "notClinical",
      emergency: judgement.emergency,
    })
    .where(and(inArray(whatsappMessage.id, turn.unjudged), isNull(whatsappMessage.judgement)))
    .run();
  return { reply: ran.reply, judgement, rules };
}

/**
 * Whether the reply may go now: no newer message waits for its own turn,
 * the window is open and the number can send.
 */
function mayReply(database: Database, cloud: WhatsappCloud, conversationId: string, read: Read) {
  const newerWaits = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), isNotNull(conversation.assistantDueAt)))
    .get();
  return !newerWaits && isWindowOpen(read.lastIncomingAt, Date.now()) && !cloud.missingSetting();
}

/** Sends `text` to the conversation's number, and stores it with the rules' version it was written under. */
async function sendReply(
  database: Database,
  cloud: WhatsappCloud,
  reply: { phone: string; text: string; rulesVersion: number },
) {
  const sent = await whileSending(database, () =>
    cloud.sendText({ to: reply.phone, text: reply.text }),
  ).catch(() => null);
  if (!sent?.ok) {
    return;
  }
  database.transaction((tx) =>
    storeOutgoing(database, tx, {
      phone: reply.phone,
      whatsappId: sent.messageId,
      type: "text",
      text: reply.text,
      payload: JSON.stringify({ text: reply.text }),
      rulesVersion: reply.rulesVersion,
    }),
  );
}

/**
 * Runs the turn of `conversationId`: judges the patient's new messages, and
 * sends the reply when underthing allows it.
 */
async function runTurn(
  database: Database,
  cloud: WhatsappCloud,
  model: AssistantModel,
  conversationId: string,
) {
  // Cleared before the model runs: a message that arrives meanwhile sets a new wait.
  database
    .update(conversation)
    .set({ assistantDueAt: null })
    .where(eq(conversation.id, conversationId))
    .run();
  const read = readConversation(database, conversationId);
  const unjudged = read.recent
    .filter((message) => message.direction === "incoming" && message.judgement === null)
    .map((message) => message.id);
  if (unjudged.length === 0) {
    return;
  }
  const patientIds = read.patients.map((one) => one.id);
  const appointments = upcomingAppointments(database, patientIds, Date.now());
  const turn = await judgeTurn(database, model, { conversationId, read, unjudged, appointments });
  // A clinical message, an unknown number or a patient with nothing booked is
  // a handoff's (#171, #176), not an answer.
  if (!turn || turn.judgement.clinical || turn.judgement.emergency || appointments.length === 0) {
    return;
  }
  const checked = checkReply(withSignOff(turn.reply, turn.rules.signOff));
  if (!checked.ok || !mayReply(database, cloud, conversationId, read)) {
    return;
  }
  await sendReply(database, cloud, {
    phone: read.phone,
    text: checked.text,
    rulesVersion: turn.rules.version,
  });
}

/** Runs every turn whose wait is over, earliest first: the object's alarm. */
export async function runDueTurns(database: Database, cloud: WhatsappCloud, model: AssistantModel) {
  if (model.missingSetting()) {
    return;
  }
  const due = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(lte(conversation.assistantDueAt, Date.now()))
    .orderBy(asc(conversation.assistantDueAt))
    .all();
  for (const { id } of due) {
    await runTurn(database, cloud, model, id);
  }
}
