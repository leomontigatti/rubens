import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { whatsappTemplates } from "#/lib/whatsapp-templates.ts";

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

// A person's reply written after the conversation's window closed
// (docs/domain/assistant.md § Handoff), through the object's methods and its
// alarm: the reply is held and the patient gets `reabrir_conversacion`; their
// answer sends the reply and closes the handoff; no answer within the
// template's chance tells the writer it was not delivered. And an assistant
// reply whose window closed meanwhile is dropped and the conversation handed
// off. Meta is faked at its HTTP boundary and the model scripted at its port.

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
/** The number as Meta is sent it. */
const martinaTo = "5491155550000";
const hour = 60 * 60_000;
const day = 24 * hour;
const reply = "Hola Martina, el jueves a las 12 te esperamos. Cualquier cosa avisanos.";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let conversationId: string;
let appointmentId: string;
let patientId: string;

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

async function read(caller: Caller = adminCaller) {
  return expectOk(await world.organization.readConversation(caller, { conversationId }));
}

async function openHandoffs(caller: Caller = adminCaller) {
  return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs;
}

function replyAs(caller: Caller, text = reply) {
  return world.organization.replyToConversation(caller, { conversationId, text });
}

async function notificationsOf(caller: Caller) {
  return expectOk(await world.organization.listNotifications(caller)).notifications;
}

/** Submits `reabrir_conversacion` with its draft, signed, and has Meta approve it at once. */
async function approveReopen() {
  const body = whatsappTemplates.reabrir_conversacion.draft.replace(
    "[firma]",
    "Consultorios Prueba",
  );
  fakeMeta.answerNextWith(200, { id: "900000000000031", status: "APPROVED", category: "UTILITY" });
  expectOk(
    await world.organization.submitWhatsappTemplate(adminCaller, {
      templateName: "reabrir_conversacion",
      body,
    }),
  );
  fakeMeta.requests = [];
}

/** The templates the object sent Meta, each with its parameters, in order. */
function templatesSent() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map(
      (request) =>
        request.body as {
          to: string;
          type: string;
          template?: {
            name: string;
            components: { parameters: { parameter_name: string; text: string }[] }[];
          };
        },
    )
    .filter((body) => body.type === "template")
    .map((body) => ({
      to: body.to,
      name: body.template!.name,
      parameters: body.template!.components.flatMap((one) =>
        one.parameters.map((parameter) => [parameter.parameter_name, parameter.text]),
      ),
    }));
}

/** Hands the conversation off to a person, then lets its window close with the receptionist holding it. */
async function handedOffThenClosed() {
  await writes("quiero hablar con alguien");
  scriptedModel.script((one) => {
    one.call("judge_messages", { clinical: false, emergency: false });
    one.call("hand_off", { reason: "patient_asked", clinical: false, appointmentId });
    return "Ya te paso con alguien.";
  });
  await afterTheWait(world.organization);
  vi.setSystemTime(Date.now() + 25 * hour);
  expectOk(await world.organization.takeOverConversation(world.receptionist, { conversationId }));
  fakeMeta.requests = [];
  scriptedModel.reset();
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
  patientId = patient.id;
  appointmentId = (
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    })
  ).id;
  await approveReopen();
  await writes("hola");
  scriptedModel.script((one) => {
    one.call("judge_messages", { clinical: false, emergency: false });
    return "Hola Martina, ¿en qué te ayudo?";
  });
  await afterTheWait(world.organization);
  const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
  conversationId = listed.conversations[0]!.id;
  fakeMeta.requests = [];
  scriptedModel.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a person's reply after the window closed", () => {
  it("is held, and the patient gets the reopen template with only their name in it", async () => {
    await handedOffThenClosed();

    expect(expectOk(await replyAs(world.receptionist))).toEqual({ ok: true, held: true });
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(templatesSent()).toEqual([
      {
        to: martinaTo,
        name: "reabrir_conversacion_v1",
        parameters: [["paciente", "Martina"]],
      },
    ]);
    expect((await read()).lateReplies).toEqual([
      {
        id: expect.any(String),
        writer: "Rita Paz",
        writtenAt: Date.now(),
        state: "waiting",
        text: `*Rita Paz*\n${reply}`,
      },
    ]);
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("goes out when the patient answers, closing the open handoff", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + 2 * day);
    fakeMeta.requests = [];

    await writes("sí, decime");
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([{ to: martinaTo, text: `*Rita Paz*\n${reply}` }]);
    expect(await openHandoffs()).toEqual([]);
    const after = await read();
    expect(after.lateReplies).toEqual([]);
    expect(after.messages.at(-1)).toMatchObject({
      sentBy: "Rita Paz",
      text: `*Rita Paz*\n${reply}`,
    });
    // The patient answered the person, who holds the conversation again: the assistant stays silent.
    expect(after.hold).toMatchObject({ mine: false, holder: "Rita Paz" });
  });

  it("waits behind one reopen template however many replies are written, which go in order", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    await runDurableObjectAlarm(world.organization);
    expectOk(await replyAs(world.receptionist, "Segunda"));
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toHaveLength(1);
    fakeMeta.requests = [];
    await writes("hola");
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent().map((one) => one.text)).toEqual([
      "*Rita Paz*\nPrimera",
      "*Rita Paz*\nSegunda",
    ]);
  });

  it("goes without the template when the patient writes before it could go", async () => {
    await handedOffThenClosed();
    // Meta refuses the template for now: the row waits for a retry.
    fakeMeta.answerNextWith(400, { error: { code: 131_000, message: "Something went wrong" } });
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];

    await writes("hola, ¿me escribieron?");
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + day);
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([{ to: martinaTo, text: `*Rita Paz*\n${reply}` }]);
    expect(templatesSent()).toEqual([]);
  });

  it("tells its writer it was not delivered when the patient never answers, sending nothing more", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];

    vi.setSystemTime(Date.now() + 7 * day - 1);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist)).toEqual([]);

    vi.setSystemTime(Date.now() + 1);
    await runDurableObjectAlarm(world.organization);

    expect(await notificationsOf(world.receptionist)).toEqual([
      expect.objectContaining({ kind: "replyNotDelivered", read: false, conversationId }),
    ]);
    expect((await read()).lateReplies).toEqual([
      expect.objectContaining({ state: "notDelivered", writer: "Rita Paz" }),
    ]);
    expect(fakeMeta.requests).toEqual([]);
    expect(await openHandoffs()).toHaveLength(1);

    // A later answer finds nothing waiting: the reply was not delivered.
    await writes("perdón, recién lo veo");
    await runDurableObjectAlarm(world.organization);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("is refused when no patient the number reaches accepts WhatsApp, holding nothing", async () => {
    await handedOffThenClosed();
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId,
        whatsappConsent: false,
      }),
    );

    expect(await replyAs(world.receptionist)).toEqual({ ok: false, reason: "cannotReopen" });
    await runDurableObjectAlarm(world.organization);
    expect(fakeMeta.requests.filter((one) => one.url.endsWith("/messages"))).toEqual([]);
    expect((await read()).lateReplies).toEqual([]);
  });

  it("withholds a practitioner's reply to a clinical handoff from reception while it waits", async () => {
    await writes("me duele mucho la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      one.call("hand_off", { reason: "clinical", clinical: true, appointmentId });
      return "Ya le paso tu mensaje al profesional.";
    });
    await afterTheWait(world.organization);
    vi.setSystemTime(Date.now() + 25 * hour);
    expectOk(await world.organization.takeOverConversation(world.juan.caller, { conversationId }));
    expectOk(await replyAs(world.juan.caller, "Tomá un ibuprofeno"));

    expect((await read(world.receptionist)).lateReplies).toEqual([
      expect.objectContaining({ writer: "Juan Gómez", text: null }),
    ]);
    expect((await read(world.juan.caller)).lateReplies).toEqual([
      expect.objectContaining({ text: "*Juan Gómez*\nTomá un ibuprofeno" }),
    ]);
  });
});

describe("an assistant reply whose window closed meanwhile", () => {
  it("is dropped and the conversation handed off, with no countdown and nothing said", async () => {
    // The patient's message is judged only after its window closed, as when the model was down.
    vi.setSystemTime(Date.now() + 2 * day);
    await patientWrites(
      world.organization,
      "¿a qué hora era?",
      martinaPhone,
      Date.now() - 24 * hour,
    );
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: false, emergency: false });
      return "Tu turno es el jueves a las 12.";
    });

    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs()).toEqual([
      expect.objectContaining({ reason: "windowClosed", clinical: false }),
    ]);
    const handoffNotified = await notificationsOf(adminCaller);
    expect(handoffNotified).toEqual([expect.objectContaining({ kind: "handoff" })]);
  });
});
