import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, min, or } from "drizzle-orm";
import type * as z from "zod";

import { defaultTimeZone } from "#/lib/offices.ts";
import {
  assistantSystemPrompt,
  assistantToolSchemas,
  handoffReply,
  newMessagesMark,
  withoutMark,
  withSignOff,
} from "#/lib/assistant.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { appointmentDay, appointmentTime } from "#/lib/template-filling.ts";

import type { AssistantModel, AssistantTool, TurnMessage } from "#/organization/assistant-model.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database, Writer } from "#/organization/database.ts";
import {
  addsToOpen,
  answeredMessage,
  openHandoff,
  openHandoffsOf,
} from "#/organization/handoffs.ts";
import type { HandoffWanted } from "#/organization/handoffs.ts";
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

type Judgement = z.output<typeof assistantToolSchemas.judge_messages.inputSchema>;

type HandOffCall = z.output<typeof assistantToolSchemas.hand_off.inputSchema>;

/** What the model recorded in a turn through its tools. */
interface Recorded {
  judgement: Judgement | null;
  handOff: HandOffCall | null;
}

/**
 * The turn's tools, run with the permissions of the conversation's number:
 * they see only the patients it is the message contact of, and their
 * upcoming appointments. The judgement and the handoff the model records
 * land in `recorded`.
 */
function turnTools(
  patients: { id: string; firstName: string }[],
  appointments: Upcoming[],
  recorded: Recorded,
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
        recorded.judgement = parsed.data;
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
    .orderBy(asc(patient.id))
    .all()
    .map((one) => ({ id: one.id, firstName: one.chosenName ?? one.firstName }));
}

const messageColumns = {
  id: whatsappMessage.id,
  sentAt: whatsappMessage.sentAt,
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
  const { phone, misunderstandings } = database
    .select({ phone: conversation.phone, misunderstandings: conversation.misunderstandings })
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
  return {
    phone,
    misunderstandings,
    patients: patientsOf(database, phone),
    unjudged,
    history,
  };
}

/** When the patient last wrote in `conversationId`, which opens its window. */
function lastIncomingAt(database: Database, conversationId: string) {
  const last = database
    .select({ at: max(whatsappMessage.sentAt) })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
      ),
    )
    .get();
  return last?.at ?? null;
}

type Read = ReturnType<typeof readConversation>;

/**
 * The messages as the model reads them: the conversation so far, one message
 * per run of the same side, as WhatsApp shows a burst; then the messages the
 * turn judges together as the patient's last, so the judgement is about
 * exactly those and the turn always ends on the patient, after
 * `newMessagesMark`. A patient's own text never carries the mark.
 */
function asTurnMessages(read: Read): TurnMessage[] {
  const contentOf = (message: Read["history"][number]) => {
    const content = message.text ?? `[${message.type}]`;
    return message.direction === "incoming" ? withoutMark(content) : content;
  };
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
  const judged = [newMessagesMark, ...read.unjudged.map(contentOf)];
  return [...messages, { role: "user", content: judged.join("\n") }];
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
 * Runs the model on the conversation: its reply, judgement and hand_off, or
 * `null` when it judged nothing or could not run.
 */
async function judgeTurn(
  database: Database,
  model: AssistantModel,
  turn: { conversationId: string; read: Read; appointments: Upcoming[] },
) {
  const rules = currentCommunicationRules(database);
  const recorded: Recorded = { judgement: null, handOff: null };
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
      tools: turnTools(turn.read.patients, turn.appointments, recorded),
    })
    // The model is unavailable: the messages wait, unjudged, for #179's retry.
    .catch(() => null);
  const { judgement } = recorded;
  if (!ran || !judgement) {
    return null;
  }
  return { reply: ran.reply, judgement, handOff: recorded.handOff, rules };
}

/**
 * Whether a free-form message may go now: the window the patient's latest
 * message opened, read now, since one may have arrived during the turn, is
 * open, and no hold of Meta's (`whatsapp-limits.ts`) keeps the number from sending.
 */
function maySend(database: Database, cloud: WhatsappCloud, conversationId: string) {
  const now = Date.now();
  return (
    isWindowOpen(lastIncomingAt(database, conversationId), now) &&
    !cloud.missingSetting() &&
    !activeHold(database, now)
  );
}

/**
 * Whether the model's reply may go now: no newer message waits for its own
 * turn, the contacts and the appointments it read are as they were, and the
 * number may send.
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
  return !newerWaits && unchanged && maySend(database, cloud, turn.conversationId);
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
  const answered = answeredMessage(database, conversationId, read.unjudged[0]!.sentAt);
  const turn = await judgeTurn(database, model, { conversationId, read, appointments });
  if (!turn) {
    return;
  }
  const settled = settleTurn(database, { conversationId, read, appointments, answered, ...turn });
  if (settled === "silent") {
    return;
  }
  // The fixed handoff reply says nothing the turn read, so a newer message or
  // a changed appointment does not hold it: the next turn is silent.
  const handedOff = settled === "handedOff";
  const text = handedOff ? handoffReply(turn.rules.formOfAddress) : turn.reply;
  // A turn that ended on its tools has no words of its own to sign.
  const words = checkReply(text);
  const checked = checkReply(withSignOff(text, turn.rules.signOff));
  const may = handedOff
    ? maySend(database, cloud, conversationId)
    : mayReply(database, cloud, { conversationId, read, appointments });
  if (!words.ok || !checked.ok || !may) {
    return;
  }
  await sendReply(database, cloud, {
    phone: read.phone,
    text: checked.text,
    rulesVersion: turn.rules.version,
  });
}

interface JudgedTurn {
  conversationId: string;
  read: Read;
  appointments: Upcoming[];
  /** The follow-up or cancellation the patient's new messages answer, if any. */
  answered: ReturnType<typeof answeredMessage>;
  judgement: Judgement;
  handOff: HandOffCall | null;
}

const modelReasons = {
  patient_asked: "patientAsked",
  organization_cancelled: "organizationCancelled",
  clinical: "clinical",
  emergency: "emergency",
} as const satisfies Record<HandOffCall["reason"], HandoffWanted["reason"]>;

/** A follow-up's answer: only a plainly good one is the assistant's; any other is the practitioner's, as clinical. */
function followUpHandoff(turn: JudgedTurn, appointmentId: string): HandoffWanted | null {
  const { judgement } = turn;
  if (judgement.followUpAnswer === "plainlyGood" && !judgement.emergency && !turn.handOff) {
    return null;
  }
  const reason = judgement.emergency ? "emergency" : "followUpAnswer";
  return { reason, clinical: true, appointmentId };
}

/** The model's hand_off, clinical when the call or the judgement says so. */
function modelHandoff(turn: JudgedTurn, handOff: HandOffCall): HandoffWanted {
  const { judgement, answered } = turn;
  // Only an appointment the turn could speak of: the model's id is checked, not trusted.
  const known = [...turn.appointments.map((one) => one.id), answered?.appointmentId];
  const named = known.find((id) => id !== undefined && id === handOff.appointmentId);
  const clinicalReason = handOff.reason === "clinical" || handOff.reason === "emergency";
  return {
    reason: modelReasons[handOff.reason],
    clinical: judgement.clinical || judgement.emergency || handOff.clinical || clinicalReason,
    appointmentId: named ?? null,
  };
}

/** What underthing hands off without the model asking: a clinical judgement, a second misunderstanding, nothing booked. */
function judgedHandoff(turn: JudgedTurn): HandoffWanted | null {
  const { judgement } = turn;
  if (judgement.clinical || judgement.emergency) {
    const reason = judgement.emergency ? "emergency" : "clinical";
    return { reason, clinical: true, appointmentId: null };
  }
  let reason: HandoffWanted["reason"] | null = null;
  if (!judgement.understood && turn.read.misunderstandings >= 1) {
    reason = "misunderstoodTwice";
  } else if (turn.read.patients.length === 0) {
    reason = "unknownNumber";
  } else if (turn.appointments.length === 0) {
    reason = "noUpcomingAppointment";
  }
  return reason ? { reason, clinical: false, appointmentId: null } : null;
}

/**
 * The handoff the turn calls for, if any (assistant.md § Handoff): a
 * follow-up's answer is sorted first, then the model's hand_off, then what
 * underthing hands off itself.
 */
function handoffWanted(turn: JudgedTurn): HandoffWanted | null {
  const { answered } = turn;
  if (answered?.kind === "followUp" && answered.firstReply) {
    return followUpHandoff(turn, answered.appointmentId);
  }
  const wanted = turn.handOff ? modelHandoff(turn, turn.handOff) : judgedHandoff(turn);
  // A handoff about nothing in particular, right after a message about an
  // appointment, concerns that appointment.
  return (
    wanted && { ...wanted, appointmentId: wanted.appointmentId ?? answered?.appointmentId ?? null }
  );
}

/**
 * Stores the turn's judgement on the messages it judged: clinical when the
 * model judged them so or they open a clinical handoff, so their words reach
 * only those who may read them. A message that arrived meanwhile is left for
 * the next turn.
 */
function storeJudgement(tx: Writer, turn: JudgedTurn, clinical: boolean) {
  tx.update(whatsappMessage)
    .set({ judgement: clinical ? "clinical" : "notClinical", emergency: turn.judgement.emergency })
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
}

/**
 * Settles the judged turn in one transaction: stores the judgement, counts a
 * misunderstanding, opens the handoff it calls for, and says what the patient
 * is told. While a handoff is open, the assistant is silent in the conversation.
 */
function settleTurn(database: Database, turn: JudgedTurn): "silent" | "handedOff" | "answered" {
  const wanted = handoffWanted(turn);
  return database.transaction((tx) => {
    storeJudgement(tx, turn, turn.judgement.clinical || wanted?.clinical === true);
    const open = openHandoffsOf(tx, turn.conversationId);
    const misunderstood = !wanted && !turn.judgement.understood;
    tx.update(conversation)
      .set({ misunderstandings: misunderstood ? turn.read.misunderstandings + 1 : 0 })
      .where(eq(conversation.id, turn.conversationId))
      .run();
    if (wanted && addsToOpen(open, wanted)) {
      openHandoff(tx, turn.conversationId, wanted);
    }
    if (open.length > 0) {
      return "silent";
    }
    return wanted ? "handedOff" : "answered";
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
