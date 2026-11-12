import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// Taking a conversation over from the inbox (docs/domain/assistant.md §
// Inbox), through the object's methods: a person holds it, the assistant
// stays silent in it and still judges, the person's reply goes under their
// name and closes the open handoff, and the conversation goes back to the
// assistant when returned or after the admin's return time. Meta is faked at
// its HTTP boundary and the model scripted at its port.

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
const hour = 60 * 60_000;

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let conversationId: string;
let appointmentId: string;

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

function turn() {
  return afterTheWait(world.organization);
}

/** Martina's conversation as `caller` reads it. */
async function read(caller: Caller = adminCaller) {
  return expectOk(await world.organization.readConversation(caller, { conversationId }));
}

async function openHandoffs(caller: Caller = adminCaller) {
  return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs;
}

function takeOver(caller: Caller) {
  return world.organization.takeOverConversation(caller, { conversationId });
}

function reply(caller: Caller, text: string) {
  return world.organization.replyToConversation(caller, { conversationId, text });
}

/** Has the next turn hand the conversation off, to the practitioner or not, about Martina's appointment. */
async function handedOff(forPractitioner: boolean) {
  await writes(
    forPractitioner ? "me duele mucho la muela, tomo algo?" : "quiero hablar con alguien",
  );
  scriptedModel.script((one) => {
    one.call("judge_messages", {
      healthQuestion: forPractitioner,
      emergency: false,
      ...(forPractitioner && { treatedBy: appointmentId }),
    });
    one.call("hand_off", {
      reason: forPractitioner ? "clinical" : "patient_asked",
      appointmentId,
    });
    return "Ya te paso con alguien.";
  });
  await turn();
  fakeMeta.requests = [];
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
  await writes("hola");
  await turn();
  const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
  conversationId = listed.conversations[0]!.id;
  fakeMeta.requests = [];
  scriptedModel.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("taking a conversation over", () => {
  it("makes a receptionist its holder with no handoff, and the assistant only judges while they hold it", async () => {
    const taken = expectOk(await takeOver(world.receptionist));

    expect(taken.heldUntil).toBe(Date.now() + 4 * hour);
    expect((await read()).window.open).toBe(true);
    expect((await read()).hold).toEqual({
      holder: "Rita Paz",
      heldUntil: Date.now() + 4 * hour,
      mine: false,
    });
    expect((await read(world.receptionist)).hold?.mine).toBe(true);

    await writes("me confirmás el horario?");
    await turn();

    expect(scriptedModel.turns).toHaveLength(1);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect((await read()).messages.at(-1)).toMatchObject({ judgement: "notForPractitioner" });
  });

  it("keeps the assistant from proposing or accepting a change while a member holds it", async () => {
    await writes("cancelame el turno");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      one.call("propose_change", { appointmentId, kind: "cancel" });
      return "¿Te lo cancelo?";
    });
    await turn();
    expectOk(await takeOver(world.receptionist));

    await writes("sí");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      one.call("propose_change", { appointmentId, kind: "confirm" });
      one.call("accept_proposal");
      return "Listo.";
    });
    await turn();

    expect(scriptedModel.calls.slice(-2).map((call) => call.result)).toEqual([
      { ok: false, reason: "held" },
      { ok: false, reason: "held" },
    ]);
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("is refused to a practitioner it was not handed to, though they have the patient's appointment", async () => {
    expect(await takeOver(world.juan.caller)).toEqual({ ok: false, reason: "notFound" });
    await handedOff(true);
    expect(await takeOver(world.lucia.caller)).toEqual({ ok: false, reason: "notFound" });
    expectOk(await takeOver(world.juan.caller));
  });

  it("takes it from whoever held it", async () => {
    await handedOff(true);
    expectOk(await takeOver(world.receptionist));
    expectOk(await takeOver(world.juan.caller));

    expect((await read()).hold?.holder).toBe("Juan Gómez");
    expect(await reply(world.receptionist, "hola")).toEqual({ ok: false, reason: "notHolding" });
  });
});

describe("who may hold, reply, return and set the return time", () => {
  /** Each of the methods, called by `caller`. */
  function everyMethod(caller: Caller) {
    return Promise.all([
      takeOver(caller),
      reply(caller, "Hola"),
      world.organization.returnConversation(caller, { conversationId }),
      world.organization.saveReturnTime(caller, { hours: 2 }),
    ]);
  }

  it("refuses an unknown member, a deactivated one, and one who must still change their password", async () => {
    const deactivated = await addRefusedAdmin(world.organization, "deactivated");
    const mustChange = await addRefusedAdmin(world.organization, "mustChangePassword");
    const refusals = [
      [{ userId: "user-nobody" }, "unauthenticated"],
      [deactivated, "unauthenticated"],
      [mustChange, "mustChangePassword"],
    ] as const;

    for (const [caller, reason] of refusals) {
      expect(await everyMethod(caller)).toEqual(Array(4).fill({ ok: false, reason }));
    }
    expect((await read()).hold).toBeNull();
    expect(fakeMeta.textsSent()).toEqual([]);
  });
});

describe("a person's reply", () => {
  it("goes to the patient under their name inside the window, and closes the open handoff", async () => {
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));

    expectOk(await reply(world.receptionist, "  Hola Martina, te llamo en un rato.  "));

    expect(fakeMeta.textsSent()).toEqual([
      { to: "5491155550000", text: "*Rita Paz*\nHola Martina, te llamo en un rato." },
    ]);
    expect((await read()).messages.at(-1)).toMatchObject({
      direction: "outgoing",
      text: "*Rita Paz*\nHola Martina, te llamo en un rato.",
      sentBy: "Rita Paz",
    });
    expect(await openHandoffs()).toEqual([]);
  });

  it("keeps the hold for the return time from the reply on", async () => {
    expectOk(await takeOver(world.receptionist));
    vi.setSystemTime(Date.now() + hour);

    expectOk(await reply(world.receptionist, "Ya lo reviso."));

    expect((await read()).hold?.heldUntil).toBe(Date.now() + 4 * hour);
  });

  it("from a receptionist leaves a handoff to the practitioner open, which the practitioner's reply closes, read by reception too", async () => {
    await handedOff(true);
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Te pasamos con el profesional."));

    expect((await openHandoffs()).map((one) => one.forPractitioner)).toEqual([true]);

    expectOk(await takeOver(world.juan.caller));
    expectOk(await reply(world.juan.caller, "Tomá un analgésico y venite mañana."));

    expect(await openHandoffs()).toEqual([]);
    expect((await read(world.receptionist)).messages.at(-1)).toMatchObject({
      direction: "outgoing",
      text: "*Juan Gómez*\nTomá un analgésico y venite mañana.",
      sentBy: "Juan Gómez",
    });
  });

  it("that Meta reports failed reopens the handoff it closed, and tells its writer", async () => {
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Hola Martina, te llamo en un rato."));
    expect(await openHandoffs()).toEqual([]);
    const [sent] = await inStorage(world.organization, (database) =>
      database
        .select({ whatsappId: whatsappMessage.whatsappId })
        .from(whatsappMessage)
        .where(eq(whatsappMessage.text, "*Rita Paz*\nHola Martina, te llamo en un rato."))
        .all(),
    );

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [{ whatsappId: sent!.whatsappId, status: "failed", at: Date.now() }],
        templateStatuses: [],
      }),
    );

    expect(await openHandoffs()).toMatchObject([{ reason: "patientAsked" }]);
    expect((await read()).messages.at(-1)).toMatchObject({ sentBy: "Rita Paz", status: "failed" });
    const told = expectOk(await world.organization.listNotifications(world.receptionist));
    expect(told.notifications.filter((one) => one.kind === "replyFailed")).toMatchObject([
      { conversationId, patient: { name: "Martina Paz" } },
    ]);
  });

  it("reopens the handoff it closed when Meta reports more replies failed in one call than one statement binds", async () => {
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));
    for (let written = 0; written < 110; written++) {
      expectOk(await reply(world.receptionist, `Respuesta ${written}`));
    }
    expect(await openHandoffs()).toEqual([]);
    const sent = await inStorage(world.organization, (database) =>
      database
        .select({ whatsappId: whatsappMessage.whatsappId })
        .from(whatsappMessage)
        .where(eq(whatsappMessage.direction, "outgoing"))
        .all(),
    );

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: sent.map((one) => ({
          whatsappId: one.whatsappId!,
          status: "failed" as const,
          at: Date.now(),
        })),
        templateStatuses: [],
      }),
    );

    expect(await openHandoffs()).toMatchObject([{ reason: "patientAsked" }]);
  });

  it("that Meta reports failed reopens nothing beside a handoff of its kind opened since", async () => {
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Hola Martina, te llamo en un rato."));
    await handedOff(false);
    const [sent] = await inStorage(world.organization, (database) =>
      database
        .select({ whatsappId: whatsappMessage.whatsappId })
        .from(whatsappMessage)
        .where(eq(whatsappMessage.text, "*Rita Paz*\nHola Martina, te llamo en un rato."))
        .all(),
    );

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [{ whatsappId: sent!.whatsappId, status: "failed", at: Date.now() }],
        templateStatuses: [],
      }),
    );

    expect(await openHandoffs()).toHaveLength(1);
    const told = expectOk(await world.organization.listNotifications(world.receptionist));
    expect(told.notifications.filter((one) => one.kind === "replyFailed")).toHaveLength(1);
  });

  it("that fail together with the same time reopen the newer handoff, the one a later reply answered", async () => {
    const sentWhatsappId = (text: string) =>
      inStorage(world.organization, (database) =>
        database
          .select({ whatsappId: whatsappMessage.whatsappId })
          .from(whatsappMessage)
          .where(eq(whatsappMessage.text, text))
          .get(),
      );
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Primera respuesta."));
    await handedOff(false);
    const [newer] = await openHandoffs();
    expectOk(await reply(world.receptionist, "Segunda respuesta."));
    // The object's clock is frozen: both replies carry the same time.
    const first = await sentWhatsappId("*Rita Paz*\nPrimera respuesta.");
    const second = await sentWhatsappId("*Rita Paz*\nSegunda respuesta.");

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [first!, second!].map(({ whatsappId }) => ({
          whatsappId,
          status: "failed" as const,
          at: Date.now(),
        })),
        templateStatuses: [],
      }),
    );

    expect((await openHandoffs()).map((one) => one.id)).toEqual([newer!.id]);
  });

  it("refuses a reply too long for Meta once signed with the name, sending nothing", async () => {
    expectOk(await takeOver(world.receptionist));

    expect(await reply(world.receptionist, "a".repeat(4096))).toEqual({
      ok: false,
      reason: "tooLong",
    });
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("is refused to a member who does not hold the conversation, sending nothing", async () => {
    expect(await reply(world.receptionist, "Hola")).toEqual({ ok: false, reason: "notHolding" });
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("is refused when Meta refuses it, leaving the handoff open", async () => {
    await handedOff(false);
    expectOk(await takeOver(world.receptionist));
    fakeMeta.answerNextWith(400, { error: { code: 131_000, message: "Something went wrong" } });

    expect(await reply(world.receptionist, "Hola")).toEqual({ ok: false, reason: "sendFailed" });
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("refuses an empty reply", async () => {
    expectOk(await takeOver(world.receptionist));
    expect(await reply(world.receptionist, "   ")).toEqual({ ok: false, reason: "invalidInput" });
  });
});

describe("giving the conversation back", () => {
  it("returns it to the assistant without a word, which answers the patient's next message", async () => {
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Listo, ya está."));
    fakeMeta.requests = [];

    expectOk(await world.organization.returnConversation(world.receptionist, { conversationId }));

    expect((await read()).hold).toBeNull();
    expect(fakeMeta.textsSent()).toEqual([]);
    await writes("gracias");
    await turn();
    expect(fakeMeta.textsSent()).toHaveLength(1);
  });

  it("is refused to a member who does not hold it", async () => {
    expectOk(await takeOver(world.receptionist));

    expect(await world.organization.returnConversation(adminCaller, { conversationId })).toEqual({
      ok: false,
      reason: "notHolding",
    });
  });

  it("leaves an open handoff open", async () => {
    await handedOff(true);
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Te pasamos con el profesional."));
    fakeMeta.requests = [];

    expectOk(await world.organization.returnConversation(world.receptionist, { conversationId }));

    expect((await openHandoffs()).map((one) => one.forPractitioner)).toEqual([true]);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("happens after the admin's return time, without a word", async () => {
    expectOk(await world.organization.saveReturnTime(adminCaller, { hours: 2 }));
    expectOk(await takeOver(world.receptionist));
    expectOk(await reply(world.receptionist, "Ya te confirmo."));
    fakeMeta.requests = [];

    vi.setSystemTime(Date.now() + 2 * hour - 1);
    await runDurableObjectAlarm(world.organization);
    expect((await read()).hold).not.toBeNull();

    vi.setSystemTime(Date.now() + 1);
    await runDurableObjectAlarm(world.organization);

    expect((await read()).hold).toBeNull();
    expect(fakeMeta.textsSent()).toEqual([]);
  });
});

describe("an emergency while a member holds the conversation", () => {
  it("gets the emergency reply anyway, and the holder an urgent notification", async () => {
    expectOk(await takeOver(world.receptionist));
    await writes("me caí y me sangra mucho la boca, no para");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: true, emergency: true });
      return "";
    });

    await turn();

    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([expect.stringContaining("107")]);
    const told = expectOk(await world.organization.listNotifications(world.receptionist));
    expect(told.notifications.filter((one) => one.kind === "emergency")).toMatchObject([
      { conversationId },
    ]);
    expect((await read()).hold).not.toBeNull();
  });
});

describe("the return time", () => {
  it("is 4 hours until an admin sets it, and only an admin sets it", async () => {
    expect(expectOk(await world.organization.whatsappSettings(adminCaller)).returnAfterHours).toBe(
      4,
    );
    expect(await world.organization.saveReturnTime(world.receptionist, { hours: 2 })).toEqual({
      ok: false,
      reason: "forbidden",
    });

    expectOk(await world.organization.saveReturnTime(adminCaller, { hours: 8 }));

    expect(expectOk(await world.organization.whatsappSettings(adminCaller)).returnAfterHours).toBe(
      8,
    );
  });

  it("is a whole number of hours from 1 to 24", async () => {
    for (const hours of [0, 25, 1.5]) {
      expect(await world.organization.saveReturnTime(adminCaller, { hours })).toEqual({
        ok: false,
        reason: "invalidInput",
      });
    }
  });
});
