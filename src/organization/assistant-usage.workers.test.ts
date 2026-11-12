import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { assistantModelId } from "#/lib/assistant.ts";

import {
  afterTheWait,
  at,
  fakeMeta,
  patientWrites,
  recordedModelUsage,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// What the assistant uses, per organization (docs/domain/assistant.md § Costs):
// each model run of a turn, the clinical check's included, records its tokens
// and its model on the organization's day. No screen shows it yet, so the tests
// read the recorded rows. The sandbox's turns are recorded as sandbox use
// (`assistant-sandbox.workers.test.ts`), and a template review as its own
// purpose (`template-review.workers.test.ts`). Voice notes record the length
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

/** A run of the turn's model, on `day`, with the tokens it used. */
function turnRun(day: string, inputTokens: number, outputTokens: number) {
  return {
    day,
    model: assistantModelId,
    purpose: "turn",
    sandbox: false,
    inputTokens,
    outputTokens,
  };
}

describe("the assistant's usage", () => {
  it("is nothing before any turn", async () => {
    expect(await recordedModelUsage(world.organization)).toEqual([]);
  });

  it("records the tokens of every model call of a turn and of its clinical check, with the model", async () => {
    twoCallTurn();
    scriptedModel.checkUses({ inputTokens: 300, outputTokens: 10 });
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toHaveLength(1);
    expect(await recordedModelUsage(world.organization)).toEqual([
      turnRun("2098-12-10", 1_200, 40),
      turnRun("2098-12-10", 1_300, 60),
      { ...turnRun("2098-12-10", 300, 10), purpose: "clinicalCheck" },
    ]);
  });

  it("records what a turn the model failed partway used", async () => {
    scriptedModel.script((turn) => {
      turn.uses({ inputTokens: 1_200, outputTokens: 40 });
      throw new Error("The scripted model is unavailable");
    });
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await recordedModelUsage(world.organization)).toEqual([
      turnRun("2098-12-10", 1_200, 40),
    ]);
  });

  it("records each run on the organization's day, not UTC's", async () => {
    // Midnight UTC of the first of January is still December 31 in Buenos Aires.
    vi.setSystemTime(new Date("2099-01-01T00:30:00Z"));
    twoCallTurn();
    await patientWrites(world.organization, "cuándo es mi turno?", martinaPhone);
    await afterTheWait(world.organization);

    expect(await recordedModelUsage(world.organization)).toEqual([
      turnRun("2098-12-31", 1_200, 40),
      turnRun("2098-12-31", 1_300, 60),
    ]);
  });
});
