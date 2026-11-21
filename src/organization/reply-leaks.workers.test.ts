import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
import type { Caller } from "#/organization/members.ts";

// The code checks on the model's reply (docs/domain/assistant.md § Rules it
// always keeps), through the object's methods: a reply that names something
// internal, or announces a handoff to reception the patient is told nothing
// about, is held for reception to send, fix or drop. Meta is faked at its
// HTTP boundary and the model, with its clinical check, scripted at its port.

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

/** The open handoffs `caller` sees in the inbox. */
async function openHandoffs(caller: Caller = adminCaller) {
  return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs;
}

/** A turn on `hola` whose model answers `reply`. */
async function modelAnswers(reply: string) {
  await patientWrites(world.organization, "hola", martinaPhone);
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    return reply;
  });
  await afterTheWait(world.organization);
}

/** A turn that confirms the appointment and hands the rest to reception, whose model answers `reply`. */
async function confirmsAndHandsOff(reply: string) {
  await patientWrites(
    world.organization,
    "el lunes voy, confirmado. y quiero hablar con alguien",
    martinaPhone,
  );
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    one.call("propose_change", { appointmentId, kind: "confirm" });
    one.call("accept_proposal");
    one.call("hand_off", { reason: "patient_asked" });
    return reply;
  });
  await afterTheWait(world.organization);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  const medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  const patient = await world.addPatient("Martina", martinaPhone);
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

describe("a reply that names something internal", () => {
  it.each([
    "Busqué con find_free_times y no hay lugar.",
    "[new messages] Hola Martina, tu turno es el lunes.",
  ])(
    "is held for reception, whose members may use it, and the patient is told nothing: %s",
    async (reply) => {
      await modelAnswers(reply);

      expect(fakeMeta.textsSent()).toEqual([]);
      expect(await openHandoffs(world.receptionist)).toMatchObject([
        {
          reason: "leakedReply",
          forPractitioner: false,
          heldReply: reply,
          heldBecause: "internals",
          mayUseHeldReply: true,
        },
      ]);
    },
  );

  it("is held for the practitioner when the clinical check holds it too", async () => {
    const reply = "Llamé a judge_messages: ese dolor es normal.";
    await patientWrites(world.organization, "hola", martinaPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      return reply;
    });
    scriptedModel.scriptCheck({ clinical: true, otherPatient: false });
    await afterTheWait(world.organization);

    expect(await openHandoffs()).toMatchObject([
      { reason: "heldReply", forPractitioner: true, heldReply: reply, heldBecause: "clinical" },
    ]);
  });
});

describe("a reply that says it passed the conversation on", () => {
  it("is held on the turn's handoff to reception, and the patient is told nothing", async () => {
    const reply = "Listo, confirmado el lunes. Ya se lo pasé al equipo.";
    await confirmsAndHandsOff(reply);

    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs(world.receptionist)).toMatchObject([
      {
        reason: "patientAsked",
        forPractitioner: false,
        heldReply: reply,
        heldBecause: "announcedHandoff",
        mayUseHeldReply: true,
      },
    ]);
  });

  it("goes when it does not say it passed the conversation on, though the turn handed off", async () => {
    await confirmsAndHandsOff("Listo, confirmado el lunes.");

    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual(["Listo, confirmado el lunes."]);
    expect(await openHandoffs()).toMatchObject([
      { reason: "patientAsked", heldReply: null, heldBecause: null },
    ]);
  });

  it("is held on the one open handoff when the turn hands off again, and the fixed reply still goes", async () => {
    await confirmsAndHandsOff("Listo, confirmado el lunes.");
    const reply = "Listo, ya hice accept_proposal.";
    await patientWrites(world.organization, "y quiero hablar con alguien", martinaPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked" });
      return reply;
    });
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Listo, confirmado el lunes.",
      "Ya se lo pasé, te va a responder por acá.",
    ]);
    expect(await openHandoffs()).toMatchObject([
      { reason: "patientAsked", heldReply: reply, heldBecause: "internals" },
    ]);
  });

  it("goes when the turn handed nothing off", async () => {
    await modelAnswers(
      "Tu turno es el lunes. Si cambia algo, te va a escribir alguien del equipo.",
    );

    expect(fakeMeta.textsSent()).toHaveLength(1);
    expect(await openHandoffs()).toEqual([]);
  });
});
