import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { withdrawnReplyNote } from "#/lib/assistant.ts";
import type { WhatsappNumberEvent } from "#/lib/whatsapp-messages.ts";

import {
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  auditEntriesFor,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
  submitTemplate,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
import { outboxMessage, whatsappMessage } from "#/organization/whatsapp-schema.ts";

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

async function withdraw(caller: Caller, lateReplyId?: string) {
  const id = lateReplyId ?? (await read(caller)).lateReplies[0]!.id;
  return world.organization.withdrawLateReply(caller, { lateReplyId: id });
}

async function notificationsOf(caller: Caller) {
  return expectOk(await world.organization.listNotifications(caller)).notifications;
}

/** Submits `reabrir_conversacion` with its draft, signed, and has Meta approve it at once. */
function approveReopen() {
  return submitTemplate(world.organization, "reabrir_conversacion", {
    status: "APPROVED",
    metaId: "900000000000031",
  });
}

/** Meta reports the reopen template moved to `status`. */
function reopenStatus(status: "approved" | "paused") {
  return world.organization.storeWhatsappEvents({
    messages: [],
    statuses: [],
    templateStatuses: [{ metaId: "900000000000031", status, reason: null }],
  });
}

function pauseReopen() {
  return reopenStatus("paused");
}

function numberTurns(event: WhatsappNumberEvent) {
  return world.organization.storeWhatsappEvents({
    messages: [],
    statuses: [],
    templateStatuses: [],
    numberEvents: [event],
  });
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

/** Meta reports the reopen template that went as failed: the patient blocked the number, say. */
async function reopenFailed() {
  const [sent] = await inStorage(world.organization, (database) =>
    database
      .select({ whatsappId: whatsappMessage.whatsappId })
      .from(whatsappMessage)
      .where(eq(whatsappMessage.type, "template"))
      .all(),
  );
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [],
      statuses: [{ whatsappId: sent!.whatsappId, status: "failed", at: Date.now() }],
      templateStatuses: [],
    }),
  );
}

/** Martina's messages now go to a guardian on another number. */
async function messagesGoToGuardian() {
  const added = expectOk(
    await world.organization.addGuardian(adminCaller, {
      patientId,
      name: "Laura Gómez",
      relationship: "Madre",
      phone: "+5491155559999",
    }),
  );
  expectOk(
    await world.organization.setMessageContact(adminCaller, {
      patientId,
      guardianId: added.guardian.id,
    }),
  );
}

/** Hands the conversation off to a person, then lets its window close with the receptionist holding it. */
async function handedOffThenClosed() {
  await writes("quiero hablar con alguien");
  scriptedModel.script((one) => {
    one.call("judge_messages", { healthQuestion: false, emergency: false });
    one.call("hand_off", { reason: "patient_asked", appointmentId });
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
    one.call("judge_messages", { healthQuestion: false, emergency: false });
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
  it("is held, and the patient gets the reopen template with only their name and the organization's in it", async () => {
    await handedOffThenClosed();

    expect(expectOk(await replyAs(world.receptionist))).toEqual({ ok: true, held: true });
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(templatesSent()).toEqual([
      {
        to: martinaTo,
        name: "reabrir_conversacion_v1",
        parameters: [
          ["paciente", "Martina"],
          ["organizacion", "Consultorios Prueba"],
        ],
      },
    ]);
    expect((await read()).lateReplies).toEqual([
      {
        id: expect.any(String),
        writer: "Rita Paz",
        writtenAt: Date.now(),
        state: "waiting",
        text: `*Rita Paz*\n${reply}`,
        mine: false,
      },
    ]);
    expect((await read(world.receptionist)).lateReplies).toEqual([
      expect.objectContaining({ mine: true }),
    ]);
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("shows the reopen template as the patient will read it while it is queued, then as its message", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));

    expect((await read(world.receptionist)).queuedReopen).toEqual({
      id: expect.any(String),
      queuedAt: Date.now(),
      text: "Hola Martina, te escribimos de Consultorios Prueba: tenemos una respuesta para vos. Respondé este mensaje para verla.",
    });

    await runDurableObjectAlarm(world.organization);
    const after = await read(world.receptionist);
    expect(after.queuedReopen).toBeNull();
    expect(after.messages.at(-1)).toMatchObject({ type: "template", text: expect.any(String) });
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

  it("waits behind one reopen template however many replies are written before it goes, which go in order", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
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

  it("is not delivered at once when Meta reports its template failed, telling its writer about whom", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    expectOk(await replyAs(world.receptionist, "Segunda"));
    await runDurableObjectAlarm(world.organization);

    await reopenFailed();
    await runDurableObjectAlarm(world.organization);

    expect((await read()).lateReplies.map((one) => one.state)).toEqual([
      "notDelivered",
      "notDelivered",
    ]);
    const told = expect.objectContaining({
      kind: "replyNotDelivered",
      conversationId,
      patient: expect.objectContaining({ id: patientId }),
    });
    expect(await notificationsOf(world.receptionist)).toEqual([told, told]);
  });

  it("gets a fresh template when the one before it failed", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    await runDurableObjectAlarm(world.organization);
    await reopenFailed();

    expectOk(await replyAs(world.receptionist, "Segunda"));
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toHaveLength(2);
    expect((await read()).lateReplies.map((one) => one.state)).toEqual(["notDelivered", "waiting"]);
  });

  it("joins the template that already went, sending no second one, with a whole chance of its own", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + 6 * day);
    expectOk(await replyAs(world.receptionist, "Segunda"));
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2 * day);
    await runDurableObjectAlarm(world.organization);
    expect((await read()).lateReplies.map((one) => one.state)).toEqual(["notDelivered", "waiting"]);
  });

  it("is not delivered when the number stopped reaching its patient, whose words it carries", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    await messagesGoToGuardian();
    fakeMeta.requests = [];

    await writes("¿quién habla?");
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await notificationsOf(world.receptionist)).toEqual([
      expect.objectContaining({ kind: "replyNotDelivered" }),
    ]);
  });

  it("drops its template not sent yet as answered when the patient wrote but the reply cannot go", async () => {
    await handedOffThenClosed();
    // Meta refuses the template for now: the row waits for a retry.
    fakeMeta.answerNextWith(400, { error: { code: 131_000, message: "Something went wrong" } });
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    await messagesGoToGuardian();

    await writes("¿quién habla?");
    await runDurableObjectAlarm(world.organization);

    const reopens = await inStorage(world.organization, (database) =>
      database
        .select({ state: outboxMessage.state, dropReason: outboxMessage.dropReason })
        .from(outboxMessage)
        .all(),
    );
    expect(reopens).toEqual([{ state: "dropped", dropReason: "answered" }]);
  });

  it("is refused while the reopen template has no approved version, holding nothing", async () => {
    await handedOffThenClosed();
    await pauseReopen();

    expect(await replyAs(world.receptionist)).toEqual({ ok: false, reason: "noReopenTemplate" });
    expect((await read()).lateReplies).toEqual([]);
  });

  it("is not delivered when its template cannot go for the template's whole chance, which is then dropped", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await pauseReopen();
    vi.setSystemTime(Date.now() + 7 * day);
    await runDurableObjectAlarm(world.organization);

    expect(await notificationsOf(world.receptionist)).toEqual([
      expect.objectContaining({ kind: "replyNotDelivered" }),
    ]);
    // Approved again, it has nothing left to reopen for.
    await reopenStatus("approved");
    await runDurableObjectAlarm(world.organization);
    expect(templatesSent()).toEqual([]);
  });

  it("sends the template again when Meta holds the number past the window the patient's answer opened", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    await numberTurns({ kind: "restricted", until: null });
    vi.setSystemTime(Date.now() + hour);
    await writes("sí, decime");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      return "";
    });
    await afterTheWait(world.organization);
    vi.setSystemTime(Date.now() + 25 * hour);
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];

    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toEqual([expect.objectContaining({ name: "reabrir_conversacion_v1" })]);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect((await read()).lateReplies).toEqual([expect.objectContaining({ state: "waiting" })]);

    await writes("acá estoy");
    await runDurableObjectAlarm(world.organization);
    expect(fakeMeta.textsSent()).toEqual([{ to: martinaTo, text: `*Rita Paz*\n${reply}` }]);
  });

  it("sends one template when Meta holds the number from before the first could go until after the window", async () => {
    await handedOffThenClosed();
    await numberTurns({ kind: "restricted", until: null });
    expectOk(await replyAs(world.receptionist));
    vi.setSystemTime(Date.now() + hour);
    await writes("sí, decime");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      return "";
    });
    await afterTheWait(world.organization);
    vi.setSystemTime(Date.now() + 25 * hour);
    await runDurableObjectAlarm(world.organization);

    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toHaveLength(1);
  });

  it("closes only the handoffs opened before it was written", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + day);
    await runDurableObjectAlarm(world.organization);
    await numberTurns({ kind: "restricted", until: null });
    // The patient answers while Meta holds the number, with something new for the practitioner.
    await writes("y además me duele la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      return "";
    });
    await afterTheWait(world.organization);
    expect(await openHandoffs()).toHaveLength(2);

    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent()).toEqual([{ to: martinaTo, text: `*Rita Paz*\n${reply}` }]);
    expect(await openHandoffs()).toEqual([expect.objectContaining({ reason: "clinical" })]);
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

  it("shows reception a practitioner's reply to a handoff to them while it waits", async () => {
    await writes("me duele mucho la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "Ya le paso tu mensaje al profesional.";
    });
    await afterTheWait(world.organization);
    vi.setSystemTime(Date.now() + 25 * hour);
    expectOk(await world.organization.takeOverConversation(world.juan.caller, { conversationId }));
    expectOk(await replyAs(world.juan.caller, "Tomá un ibuprofeno"));

    expect((await read(world.receptionist)).lateReplies).toEqual([
      expect.objectContaining({ writer: "Juan Gómez", text: "*Juan Gómez*\nTomá un ibuprofeno" }),
    ]);
    expect((await read(world.juan.caller)).lateReplies).toEqual([
      expect.objectContaining({ text: "*Juan Gómez*\nTomá un ibuprofeno" }),
    ]);
  });
});

describe("withdrawing a late reply", () => {
  it("takes it out of the conversation for everyone, and it never goes when the patient answers", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];
    const { id } = (await read()).lateReplies[0]!;

    expect(await withdraw(world.receptionist, id)).toEqual({ ok: true });

    expect((await read(world.receptionist)).lateReplies).toEqual([]);
    expect((await read()).lateReplies).toEqual([]);
    await writes("sí, decime");
    await runDurableObjectAlarm(world.organization);
    expect(fakeMeta.textsSent()).toEqual([]);
    // The handoff it would have answered stays open.
    expect(await openHandoffs()).toHaveLength(1);
    expect(await auditEntriesFor(world.organization, id)).toEqual([
      expect.objectContaining({
        action: "update",
        userId: world.receptionist.userId,
        before: { state: "waiting" },
        after: { state: "withdrawn" },
      }),
    ]);
    // Nor is its writer told later that it was not delivered.
    vi.setSystemTime(Date.now() + 8 * day);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist)).toEqual([]);
  });

  it("leaves a trace in the conversation with who withdrew it and when, without its words", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    const { id } = (await read()).lateReplies[0]!;
    vi.setSystemTime(Date.now() + hour);

    expectOk(await withdraw(world.receptionist, id));

    const expected = [{ id, writer: "Rita Paz", withdrawnAt: Date.now() }];
    expect((await read()).withdrawnReplies).toEqual(expected);
    expect((await read(world.receptionist)).withdrawnReplies).toEqual(expected);
  });

  it("tells the assistant the team withdrew its pending reply when the template had gone", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    expectOk(await withdraw(world.receptionist));

    await writes("sí, decime");
    await afterTheWait(world.organization);

    const template = scriptedModel.turns
      .at(-1)!
      .messages.find((one) => one.content.includes("tenemos una respuesta para vos"));
    expect(template).toEqual({
      role: "assistant",
      content: expect.stringContaining(withdrawnReplyNote),
    });
  });

  it("tells the assistant nothing withdrawn while another reply behind the template is left", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    expectOk(await replyAs(world.receptionist, "Segunda"));
    await runDurableObjectAlarm(world.organization);
    expectOk(await withdraw(world.receptionist));

    await writes("hola");
    await afterTheWait(world.organization);

    const said = scriptedModel.turns.at(-1)!.messages.map((one) => one.content);
    expect(said.join("\n")).not.toContain(withdrawnReplyNote);
  });

  it("drops the reopen template not sent yet when no other reply waits behind it", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));

    expectOk(await withdraw(world.receptionist));
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toEqual([]);
  });

  it("keeps the reopen template for the replies still waiting behind it", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist, "Primera"));
    expectOk(await replyAs(world.receptionist, "Segunda"));

    expectOk(await withdraw(world.receptionist));
    await runDurableObjectAlarm(world.organization);
    expect(templatesSent()).toHaveLength(1);
    await writes("hola");
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent().map((one) => one.text)).toEqual(["*Rita Paz*\nSegunda"]);
  });

  it("never goes when withdrawn while the alarm sends another conversation's reply", async () => {
    const luciaPhone = "+5491155551111";
    await world.addPatient("Lucía", luciaPhone);
    await patientWrites(world.organization, "hola", luciaPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      return "Hola Lucía, ¿en qué te ayudo?";
    });
    await afterTheWait(world.organization);
    await handedOffThenClosed();
    const lucias = expectOk(
      await world.organization.listConversations(adminCaller, {}),
    ).conversations.find((one) => one.phone === luciaPhone)!.id;
    expectOk(
      await world.organization.takeOverConversation(world.receptionist, {
        conversationId: lucias,
      }),
    );
    expectOk(await replyAs(world.receptionist, "Para Martina"));
    expectOk(
      await world.organization.replyToConversation(world.receptionist, {
        conversationId: lucias,
        text: "Para Lucía",
      }),
    );
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];
    const luciasReply = expectOk(
      await world.organization.readConversation(world.receptionist, { conversationId: lucias }),
    ).lateReplies[0]!.id;

    // Martina answers and Meta is slow to take her reply; meanwhile the other reply is withdrawn and its patient answers too.
    await writes("sí, decime");
    const release = fakeMeta.holdNext();
    const settling = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);
    expectOk(await withdraw(world.receptionist, luciasReply));
    await patientWrites(world.organization, "hola de nuevo", luciaPhone);
    release();
    await settling;
    await runDurableObjectAlarm(world.organization);

    expect(fakeMeta.textsSent().map((one) => one.text)).toEqual(["*Rita Paz*\nPara Martina"]);
  });

  it("is refused to anyone but its writer", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    const { id } = (await read()).lateReplies[0]!;

    expect(await withdraw(adminCaller, id)).toEqual({ ok: false, reason: "notFound" });
    expect((await read()).lateReplies).toEqual([expect.objectContaining({ state: "waiting" })]);
  });

  it("is refused to an unknown member, a deactivated one, and one who must still change their password", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    const { id } = (await read()).lateReplies[0]!;
    const refusals = [
      [{ userId: "user-nobody" }, "unauthenticated"],
      [await addRefusedAdmin(world.organization, "deactivated"), "unauthenticated"],
      [await addRefusedAdmin(world.organization, "mustChangePassword"), "mustChangePassword"],
    ] as const;

    for (const [caller, reason] of refusals) {
      expect(await withdraw(caller, id)).toEqual({ ok: false, reason });
    }
    expect((await read()).lateReplies).toEqual([expect.objectContaining({ state: "waiting" })]);
  });

  it("is refused once the patient answered, and once it went", async () => {
    await handedOffThenClosed();
    expectOk(await replyAs(world.receptionist));
    const { id } = (await read()).lateReplies[0]!;
    // Meta holds the number, so the reply waits although the patient answered.
    await numberTurns({ kind: "restricted", until: null });
    await writes("sí, decime");

    expect(await withdraw(world.receptionist, id)).toEqual({ ok: false, reason: "answered" });

    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);
    expect(fakeMeta.textsSent()).toEqual([{ to: martinaTo, text: `*Rita Paz*\n${reply}` }]);
    expect(await withdraw(world.receptionist, id)).toEqual({ ok: false, reason: "notWaiting" });
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
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      return "Tu turno es el jueves a las 12.";
    });

    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs()).toEqual([
      expect.objectContaining({ reason: "windowClosed", forPractitioner: false }),
    ]);
    const handoffNotified = await notificationsOf(adminCaller);
    expect(handoffNotified).toEqual([expect.objectContaining({ kind: "handoff" })]);
  });
});
