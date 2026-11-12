import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { assistantModelId } from "#/lib/assistant.ts";

import {
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// What the assistant uses, per organization (docs/domain/assistant.md § Costs):
// each model run of a turn, the clinical check's included, records its tokens
// and its model on the organization's day, and admins read the month's totals
// in the WhatsApp settings, which refuse anyone else (`whatsapp.workers.test.ts`).
// The sandbox's turns are recorded as sandbox use, shown apart in the month's
// totals (`assistant-sandbox.workers.test.ts`). Voice notes record the length
// of their audio (`voice-notes.workers.test.ts`).
// The model is scripted at its port, reporting the
// tokens each of its calls used; Meta is faked at its HTTP boundary.

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

/** The month's usage as an admin reads it in the WhatsApp settings. */
async function monthUsage() {
  return expectOk(await world.organization.whatsappSettings(adminCaller)).usage;
}

/** A turn of two model calls, a tool lookup and the reply, with the tokens each used. */
function twoCallTurn() {
  scriptedModel.script((turn) => {
    turn.uses({ inputTokens: 1_200, outputTokens: 40 });
    turn.call("judge_messages", notClinical);
    turn.uses({ inputTokens: 1_300, outputTokens: 60 });
    return "Hola Martina, tu turno es el lunes a las 09:00.";
  });
}

beforeEach(async () => {
  // A month before the appointments, so the alarm fires only when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-10T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  const service = await world.addMedicalService(world.juan.practitionerId);
  const patient = await world.addPatient("Martina", martinaPhone);
  await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId: service.id,
    start: at("12:00"),
    durationMinutes: 30,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the assistant's usage", () => {
  it("is nothing in a month with no turn", async () => {
    expect(await monthUsage()).toEqual({ month: "2098-12", models: [], transcriptions: [] });
  });

  it("records the tokens of every model call of a turn and of its clinical check, with the model", async () => {
    twoCallTurn();
    scriptedModel.checkUses({ inputTokens: 300, outputTokens: 10 });
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toHaveLength(1);
    expect(await monthUsage()).toEqual({
      month: "2098-12",
      models: [{ model: assistantModelId, sandbox: false, inputTokens: 2_800, outputTokens: 110 }],
      transcriptions: [],
    });
  });

  it("records what a turn the model failed partway used", async () => {
    scriptedModel.script((turn) => {
      turn.uses({ inputTokens: 1_200, outputTokens: 40 });
      throw new Error("The scripted model is unavailable");
    });
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect((await monthUsage()).models).toEqual([
      { model: assistantModelId, sandbox: false, inputTokens: 1_200, outputTokens: 40 },
    ]);
  });

  it("adds each turn of the month, and leaves last month's out", async () => {
    twoCallTurn();
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);
    // The first of January in Buenos Aires: December's turn is last month's.
    vi.setSystemTime(new Date("2099-01-01T03:00:00Z"));
    twoCallTurn();
    await patientWrites(world.organization, "y dónde queda?", martinaPhone);
    await afterTheWait(world.organization);
    twoCallTurn();
    await patientWrites(world.organization, "gracias", martinaPhone);
    await afterTheWait(world.organization);

    expect(await monthUsage()).toEqual({
      month: "2099-01",
      models: [{ model: assistantModelId, sandbox: false, inputTokens: 5_000, outputTokens: 200 }],
      transcriptions: [],
    });
  });
});
