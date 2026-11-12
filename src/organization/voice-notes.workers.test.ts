import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  metaAccessToken,
  patientSpeaks,
  patientWrites,
  recordedTranscriptions,
  scriptedModel,
  scriptedTranscriber,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// Patients' voice notes (docs/domain/assistant.md § For patients): the
// object's alarm downloads each one from Meta, has it transcribed, and the
// transcript runs the same turn as the same words written. A note that
// cannot be understood gets a request to write it, and a second in a row is
// handed off. Each transcription's audio length is recorded for the
// organization (§ Costs). Meta is faked at its HTTP boundary, transcription
// and the model at their ports.

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

vi.mock(import("#/organization/transcription.ts"), async (original) => ({
  ...(await original()),
  transcriberFor: () => scriptedTranscriber,
}));

const martinaPhone = "+5491155550000";
const lucasPhone = "+5491155550001";

const notClinical = { healthQuestion: false, emergency: false };

/** What the patient is told on a handoff, as `vos`. */

/** What the patient is told of a voice note nobody could understand, as `vos`. */
const writeItText =
  "Perdón, no pudimos entender tu nota de voz. Escribinos lo que necesitás, por favor.";

const minuteMs = 60_000;

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

/** Books `firstName`, reached at `phone`, with Juan on the first Monday. */
async function book(firstName: string, phone: string, start = at("12:00")) {
  const patient = await world.addPatient(firstName, phone);
  await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId: (await world.addMedicalService(world.juan.practitionerId)).id,
    start,
    durationMinutes: 30,
  });
}

function speaks(words: string, from = martinaPhone) {
  return patientSpeaks(world.organization, words, from);
}

function turn() {
  return afterTheWait(world.organization);
}

/** The conversation of `phone` as an admin reads it in the inbox. */
async function inboxOf(phone: string) {
  const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
  const found = listed.conversations.find((one) => one.phone === phone)!;
  return expectOk(
    await world.organization.readConversation(adminCaller, { conversationId: found.id }),
  ).messages;
}

async function openHandoffs() {
  return expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
}

function scheduledAlarm() {
  return runInDurableObject(world.organization, (_instance, state) => state.storage.getAlarm());
}

beforeEach(async () => {
  // A month before the appointments, so the alarm fires only when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  scriptedTranscriber.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  await book("Martina", martinaPhone);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a voice note", () => {
  it("runs the same turn on its transcript as on the same words written, and is answered in text", async () => {
    await book("Lucas", lucasPhone, at("13:00"));
    await patientWrites(world.organization, "quiero confirmar el turno del lunes", lucasPhone);
    await turn();
    await speaks("quiero confirmar el turno del lunes");
    await turn();

    expect(scriptedModel.turns).toHaveLength(2);
    const [written, spoken] = scriptedModel.turns;
    expect(spoken!.messages).toEqual(written!.messages);
    expect(scriptedTranscriber.heard).toEqual([
      { audio: "quiero confirmar el turno del lunes", mimeType: "audio/ogg; codecs=opus" },
    ]);
    // Meta serves the audio only with the number's token.
    const download = fakeMeta.requests.find((request) => request.url.includes("fbsbx.com"))!;
    expect(download.authorization).toBe(`Bearer ${metaAccessToken}`);
    expect(fakeMeta.sendsInOrder().filter((sent) => "to" in sent)).toEqual([
      { to: "5491155550001", type: "text", text: "Hola, en qué te puedo ayudar?" },
      { to: "5491155550000", type: "text", text: "Hola, en qué te puedo ayudar?" },
    ]);
  });

  it("shows its transcript in the inbox as the patient's words", async () => {
    await speaks("a qué hora es mi turno");
    await turn();

    expect(await inboxOf(martinaPhone)).toMatchObject([
      { direction: "incoming", type: "audio", text: "a qué hora es mi turno" },
      { direction: "outgoing" },
    ]);
  });

  it("is transcribed once, though the model could not read it the first time", async () => {
    await speaks("a qué hora es mi turno");
    scriptedModel.script(() => {
      throw new Error("The model is overloaded");
    });
    await turn();
    vi.setSystemTime(Date.now() + minuteMs);
    await runDurableObjectAlarm(world.organization);

    expect(scriptedModel.turns).toHaveLength(2);
    expect(scriptedTranscriber.heard).toHaveLength(1);
  });
});

describe("a message that arrives while a voice note is transcribed", () => {
  it("is left for a turn of its own: a voice note is transcribed there, not read as audio", async () => {
    await speaks("hola");
    const release = fakeMeta.holdNext();
    vi.setSystemTime(Date.now() + 8_000);
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);
    await speaks("a qué hora es mi turno");
    release();
    await alarm;

    expect(scriptedModel.turns[0]!.messages.at(-1)).toEqual({
      role: "user",
      content: "[new messages]\nhola",
    });
    await turn();

    expect(scriptedModel.turns[1]!.messages.at(-1)).toEqual({
      role: "user",
      content: "[new messages]\na qué hora es mi turno",
    });
    expect(fakeMeta.textsSent()).toHaveLength(1);
  });

  it("is answered in a turn of its own when it is text", async () => {
    await speaks("hola");
    const release = fakeMeta.holdNext();
    vi.setSystemTime(Date.now() + 8_000);
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);
    await patientWrites(world.organization, "a qué hora es mi turno", martinaPhone);
    release();
    await alarm;
    await turn();

    expect(scriptedModel.turns.map((one) => one.messages.at(-1)?.content)).toEqual([
      "[new messages]\nhola",
      "[new messages]\na qué hora es mi turno",
    ]);
    expect(fakeMeta.textsSent()).toHaveLength(1);
  });
});

describe("a voice note that cannot be transcribed now", () => {
  it("waits unanswered, and is retried a minute later, while transcription is unavailable", async () => {
    await speaks("a qué hora es mi turno");
    scriptedTranscriber.fails = true;
    await turn();

    expect(scriptedModel.turns).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await scheduledAlarm()).toBe(Date.now() + minuteMs);

    scriptedTranscriber.fails = false;
    vi.setSystemTime(Date.now() + minuteMs);
    await runDurableObjectAlarm(world.organization);

    expect(scriptedModel.turns).toHaveLength(1);
    expect(fakeMeta.textsSent()).toHaveLength(1);
  });

  it("waits unanswered, and is retried, while Meta does not serve its audio", async () => {
    const { mediaId } = await speaks("a qué hora es mi turno");
    fakeMeta.media.delete(mediaId);
    await turn();

    expect(scriptedTranscriber.heard).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await scheduledAlarm()).toBe(Date.now() + minuteMs);
  });

  it("holds back the text written beside it, which the next turn reads with it", async () => {
    await patientWrites(world.organization, "hola", martinaPhone);
    await speaks("a qué hora es mi turno");
    scriptedTranscriber.fails = true;
    await turn();

    expect(scriptedModel.turns).toEqual([]);

    scriptedTranscriber.fails = false;
    vi.setSystemTime(Date.now() + minuteMs);
    await runDurableObjectAlarm(world.organization);

    expect(scriptedModel.turns[0]!.messages.at(-1)).toEqual({
      role: "user",
      content: "[new messages]\nhola\na qué hora es mi turno",
    });
  });
});

describe("a voice note nobody can understand", () => {
  beforeEach(() => {
    scriptedTranscriber.hears("ruido", { text: "  ", seconds: 4 });
  });

  it("gets a request to write it, without the model, and a second in a row is handed off", async () => {
    await speaks("ruido");
    await turn();

    expect(scriptedModel.turns).toEqual([]);
    expect(await openHandoffs()).toEqual([]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([writeItText]);

    await speaks("ruido");
    await turn();

    expect(scriptedModel.turns).toEqual([]);
    expect((await openHandoffs())[0]).toMatchObject({
      reason: "voiceUnintelligible",
      forPractitioner: false,
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([writeItText]);
  });

  it("counts again from an understood message in between", async () => {
    await speaks("ruido");
    await turn();
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      return "El lunes a las 09:00.";
    });
    await turn();
    await speaks("ruido");
    await turn();

    expect(await openHandoffs()).toEqual([]);
    expect(fakeMeta.textsSent().at(-1)?.text).toBe(writeItText);
  });
});

describe("transcription's use", () => {
  it("records each transcribed voice note's audio length for the organization", async () => {
    scriptedTranscriber.hears("ruido", { text: "", seconds: 4 });
    scriptedTranscriber.hears("cuándo es mi turno", { text: "cuándo es mi turno", seconds: 3.5 });
    await speaks("cuándo es mi turno");
    await turn();
    await speaks("ruido");
    await turn();

    const heard = { day: "2098-12-01", model: "@cf/openai/whisper-large-v3-turbo", sandbox: false };
    expect(await recordedTranscriptions(world.organization)).toEqual([
      { ...heard, audioMs: 3_500 },
      { ...heard, audioMs: 4_000 },
    ]);
  });

  it("records nothing for a transcription that failed", async () => {
    await speaks("cuándo es mi turno");
    scriptedTranscriber.fails = true;
    await turn();

    expect(await recordedTranscriptions(world.organization)).toEqual([]);
  });
});
