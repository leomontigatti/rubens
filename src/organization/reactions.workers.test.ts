import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { conversationWindowMs } from "#/lib/conversation-window.ts";

import {
  adminCaller,
  afterTheWait as afterWait,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientReacts,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A patient's WhatsApp reactions (docs/domain/assistant.md § Proposals): what
// the model reads of them, the yes a 👍 on the latest proposal gives, and the
// inbox showing each under the message it reacts to.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

vi.mock(import("#/organization/assistant-model.ts"), async (original) => ({
  ...(await original()),
  assistantModelFor: () => scriptedModel,
}));

const martinaPhone = "+5491155550000";
const notClinical = { healthQuestion: false, emergency: false };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let appointmentId: string;

function afterTheWait() {
  return afterWait(world.organization);
}

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

function reacts(reactsTo: string, emoji: string) {
  return patientReacts(world.organization, { from: martinaPhone, reactsTo, emoji });
}

/** Meta's id for the message the assistant sent with `text`. */
function sentId(text: string) {
  return inStorage(world.organization, (database) =>
    database
      .select({ whatsappId: whatsappMessage.whatsappId })
      .from(whatsappMessage)
      .where(and(eq(whatsappMessage.direction, "outgoing"), eq(whatsappMessage.text, text)))
      .get(),
  ).then((row) => row!.whatsappId);
}

/** What the model read last: every message of its latest turn, as one string per message. */
function lastTurnRead() {
  return scriptedModel.turns.at(-1)!.messages.map((message) => message.content);
}

/** Martina's conversation as an admin reads it in the inbox. */
async function conversationShown() {
  const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
  const read = expectOk(
    await world.organization.readConversation(adminCaller, {
      conversationId: listed.conversations[0]!.id,
    }),
  );
  return { listed: listed.conversations[0]!, read };
}

/** The assistant answers the patient's `hello` with `reply`, and returns its Meta id. */
async function assistantAnswers(hello: string, reply: string) {
  await writes(hello);
  scriptedModel.script((turn) => {
    turn.call("judge_messages", notClinical);
    return reply;
  });
  await afterTheWait();
  return sentId(reply);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  const patient = await world.addPatient("Martina", martinaPhone);
  const medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  appointmentId = (
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: patient.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the patient's reactions", () => {
  it("reads a 👍 on the proposal to the model with the proposal's words, and accepts it as the yes", async () => {
    const proposal = "Confirmo tu Consulta con Juan Gómez del lunes 5 de enero a las 09:00?";
    await writes("lo puedo confirmar?");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("propose_change", { appointmentId, kind: "confirm" });
      return proposal;
    });
    await afterTheWait();

    await reacts(await sentId(proposal), "👍");
    let accepted: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      accepted = turn.call("accept_proposal");
      return "Listo, quedó confirmado.";
    });
    await afterTheWait();

    expect(lastTurnRead().at(-1)).toBe(`[new messages]\n[reaccionó 👍 al mensaje: «${proposal}»]`);
    expect(accepted).toMatchObject({ ok: true });
    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
  });

  it("starts no turn and leaves the window as it was for a reaction the patient took back", async () => {
    const reply = await assistantAnswers("hola", "Hola, en qué te puedo ayudar?");
    await reacts(reply, "😮");
    const reactedAt = Date.now();
    await afterTheWait();
    const turns = scriptedModel.turns.length;

    vi.setSystemTime(Date.now() + 60_000);
    await reacts(reply, "");
    await afterTheWait();

    expect(scriptedModel.turns).toHaveLength(turns);
    const { read } = await conversationShown();
    expect(read.window.closesAt).toBe(reactedAt + conversationWindowMs);
  });

  it("reads only the reaction the patient left on a message: none once taken back, the last once replaced", async () => {
    const first = await assistantAnswers("hola", "Hola, en qué te puedo ayudar?");
    const second = await assistantAnswers("y la dirección?", "Av. Siempre Viva 123.");
    await reacts(first, "😮");
    await afterTheWait();
    await reacts(first, "");
    await reacts(second, "👍");
    await afterTheWait();
    await reacts(second, "❤️");
    await afterTheWait();

    await writes("gracias");
    await afterTheWait();

    const read = lastTurnRead().join("\n");
    expect(read).not.toContain("😮");
    expect(read).not.toContain("👍");
    expect(read).toContain("[reaccionó ❤️ al mensaje: «Av. Siempre Viva 123.»]");
  });

  it("shows the patient's reaction under the message it reacts to, not as a message nor in the list, and none once taken back", async () => {
    const reply = await assistantAnswers("hola", "Hola, en qué te puedo ayudar?");
    await reacts(reply, "👍");

    const reacted = await conversationShown();
    expect(reacted.read.messages.map(({ text, reaction }) => ({ text, reaction }))).toEqual([
      { text: "hola", reaction: null },
      { text: "Hola, en qué te puedo ayudar?", reaction: "👍" },
    ]);
    expect(reacted.listed.lastMessage.text).toBe("Hola, en qué te puedo ayudar?");

    await reacts(reply, "");

    const takenBack = await conversationShown();
    expect(takenBack.read.messages.map(({ reaction }) => reaction)).toEqual([null, null]);
  });
});
