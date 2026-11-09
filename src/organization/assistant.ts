import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, min, or } from "drizzle-orm";

import { defaultTimeZone } from "#/lib/offices.ts";
import { assistantSystemPrompt, assistantToolSchemas, withSignOff } from "#/lib/assistant.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { appointmentDay, appointmentTime } from "#/lib/template-filling.ts";

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
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import {
  patientsReachedAt,
  storeOutgoing,
  whileSending,
} from "#/organization/whatsapp-messages.ts";

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
  const start = new Date(upcoming.startsAt);
  return {
    date: appointmentDay(start, upcoming.timeZone),
    time: appointmentTime(start, upcoming.timeZone),
  };
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

/**
 * The patients `phone` is the message contact of now, by name: read at the
 * turn, not from the conversation's links, which date from its last message.
 */
function patientsOf(database: Database, phone: string) {
  const ids = patientsReachedAt(database, phone).map((one) => one.id);
  if (ids.length === 0) {
    return [];
  }
  return database
    .select({ id: patient.id, firstName: patient.firstName, chosenName: patient.chosenName })
    .from(patient)
    .where(inArray(patient.id, ids))
    .all()
    .map((one) => ({ id: one.id, firstName: one.chosenName ?? one.firstName }));
}

const messageColumns = {
  id: whatsappMessage.id,
  direction: whatsappMessage.direction,
  type: whatsappMessage.type,
  text: whatsappMessage.text,
};

/**
 * The conversation as a turn reads it: its number, its patients, the
 * messages it judges (every incoming one not judged yet), and the latest
 * others as the conversation so far.
 */
function readConversation(database: Database, conversationId: string) {
  const { phone } = database
    .select({ phone: conversation.phone })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get()!;
  const inConversation = eq(whatsappMessage.conversationId, conversationId);
  const notJudged = and(
    eq(whatsappMessage.direction, "incoming"),
    isNull(whatsappMessage.judgement),
  );
  const unjudged = database
    .select(messageColumns)
    .from(whatsappMessage)
    .where(and(inConversation, notJudged))
    .orderBy(asc(whatsappMessage.sentAt))
    .all();
  const history = database
    .select(messageColumns)
    .from(whatsappMessage)
    .where(
      and(
        inConversation,
        or(eq(whatsappMessage.direction, "outgoing"), isNotNull(whatsappMessage.judgement)),
      ),
    )
    .orderBy(desc(whatsappMessage.sentAt))
    .limit(historyLength)
    .all()
    .reverse();
  const lastIncoming = database
    .select({ at: max(whatsappMessage.sentAt) })
    .from(whatsappMessage)
    .where(and(inConversation, eq(whatsappMessage.direction, "incoming")))
    .get();
  return {
    phone,
    patients: patientsOf(database, phone),
    unjudged,
    history,
    lastIncomingAt: lastIncoming?.at ?? null,
  };
}

type Read = ReturnType<typeof readConversation>;

/**
 * The messages as the model reads them: the conversation so far, one message
 * per run of the same side, as WhatsApp shows a burst; then the messages the
 * turn judges together as the patient's last, so the judgement is about
 * exactly those and the turn always ends on the patient.
 */
function asTurnMessages(read: Read): TurnMessage[] {
  const contentOf = (message: Read["history"][number]) => message.text ?? `[${message.type}]`;
  const messages: TurnMessage[] = [];
  for (const message of read.history) {
    const role = message.direction === "incoming" ? "user" : "assistant";
    const last = messages.at(-1);
    if (last?.role === role) {
      last.content = `${last.content}\n${contentOf(message)}`;
    } else {
      messages.push({ role, content: contentOf(message) });
    }
  }
  return [...messages, { role: "user", content: read.unjudged.map(contentOf).join("\n") }];
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

/**
 * Runs the model on the conversation and stores its judgement on the
 * messages `unjudged`: its reply, or `null` when it judged nothing or could
 * not run. A message that arrived meanwhile is left for the next turn.
 */
async function judgeTurn(
  database: Database,
  model: AssistantModel,
  turn: { conversationId: string; read: Read; appointments: Upcoming[] },
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
      messages: asTurnMessages(turn.read),
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
    .where(
      and(
        inArray(
          whatsappMessage.id,
          turn.read.unjudged.map((message) => message.id),
        ),
        isNull(whatsappMessage.judgement),
      ),
    )
    .run();
  return { reply: ran.reply, judgement, rules };
}

/**
 * Whether the reply may go now: no newer message waits for its own turn, the
 * appointments it read are as they were, the window is open, and the number
 * can send. A restriction stops only conversations the business starts, so
 * a reply still goes under one (`whatsapp-limits.ts`).
 */
function mayReply(
  database: Database,
  cloud: WhatsappCloud,
  turn: { conversationId: string; read: Read; appointments: Upcoming[] },
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
    JSON.stringify(
      upcomingAppointments(
        database,
        patients.map((one) => one.id),
        now,
      ),
    ) === JSON.stringify(turn.appointments);
  const hold = activeHold(database, now);
  return (
    !newerWaits &&
    unchanged &&
    isWindowOpen(turn.read.lastIncomingAt, now) &&
    !cloud.missingSetting() &&
    (!hold || hold.reason === "restricted")
  );
}

/** Sends `text` to the conversation's number, and stores it with the rules' version it was written under. */
async function sendReply(
  database: Database,
  cloud: WhatsappCloud,
  reply: { phone: string; text: string; rulesVersion: number },
) {
  // A send that did not reach Meta drops the reply, as a refusal does: the
  // patient's messages stay judged, and their next one gets a turn of its own.
  const sent = await whileSending(database, () =>
    cloud.sendText({ to: reply.phone, text: reply.text }),
  ).catch(() => null);
  if (!sent) {
    return;
  }
  if (!sent.ok) {
    // A limit on the number holds the outbox too.
    holdOnRefusal(database, sent.metaError);
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
  // Claimed only while still due, then cleared before the model runs: a
  // message that arrived during an earlier turn of the batch restarted the
  // wait, and one that arrives during this one sets a new wait.
  const claimed = database
    .update(conversation)
    .set({ assistantDueAt: null })
    .where(and(eq(conversation.id, conversationId), lte(conversation.assistantDueAt, Date.now())))
    .returning({ id: conversation.id })
    .get();
  if (!claimed) {
    return;
  }
  const read = readConversation(database, conversationId);
  if (read.unjudged.length === 0) {
    return;
  }
  const patientIds = read.patients.map((one) => one.id);
  const appointments = upcomingAppointments(database, patientIds, Date.now());
  const turn = await judgeTurn(database, model, { conversationId, read, appointments });
  // A clinical message, an unknown number or a patient with nothing booked is
  // a handoff's (#171, #176), not an answer.
  if (!turn || turn.judgement.clinical || turn.judgement.emergency || appointments.length === 0) {
    return;
  }
  // A turn that ended on its tools has no words of its own to sign.
  const words = checkReply(turn.reply);
  const checked = checkReply(withSignOff(turn.reply, turn.rules.signOff));
  if (
    !words.ok ||
    !checked.ok ||
    !mayReply(database, cloud, { conversationId, read, appointments })
  ) {
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
