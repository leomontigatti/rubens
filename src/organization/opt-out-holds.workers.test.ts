import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addStaff,
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  at,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  patientSends,
  patientSpeaks,
  patientWrites,
  scriptedModel,
  scriptedTranscriber,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
import { member } from "#/organization/schema.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";

// The hold an opt-out-looking reply puts on the number
// (docs/domain/patients.md § WhatsApp consent): every message the
// organization starts to a patient whose messages go to that number waits
// until reception turns the patient off or keeps them, and reception is
// reminded daily meanwhile. Meta is faked at its HTTP boundary and the model
// scripted at its port.

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

const numberPhone = "+5491155550000";

const hourMs = 60 * 60_000;
const dayMs = 24 * hourMs;

const confirmationBody =
  "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

/** The drafts the medical service sends: the booking confirmation, and the reminders 48 and 2 hours before. */
let templates: { confirmation: string; at48: string; at2: string };

/** Has Meta approve the booking confirmation at once. */
function approveConfirmation() {
  return submitTemplate(world.organization, templates.confirmation, {
    status: "APPROVED",
    metaId: "900000000000041",
    body: confirmationBody,
  });
}

/** Has Meta approve both reminders at once, the first draft retimed to 48 hours before. */
async function approveReminders() {
  await submitTemplate(world.organization, templates.at48, {
    status: "APPROVED",
    metaId: "900000000000042",
    timing: { when: "before", hours: 48 },
  });
  await submitTemplate(world.organization, templates.at2, {
    status: "APPROVED",
    metaId: "900000000000043",
  });
}

/** Has the medical service send the booking confirmation or not, and the reminders `hours` before. */
function setMessages(bookingConfirmation: boolean, hours: (48 | 2)[]) {
  return world.pickTemplates(medicalServiceId, [
    ...(bookingConfirmation ? [templates.confirmation] : []),
    ...hours.map((before) => (before === 48 ? templates.at48 : templates.at2)),
  ]);
}

function bookAt(patientId: string, time: string) {
  return world.book({
    practitionerId: world.juan.practitionerId,
    patientId,
    medicalServiceId,
    start: at(time),
    durationMinutes: 30,
    confirmWarnings: true,
  });
}

/** Registers `firstName` with a guardian on the number as their message contact. */
async function addThroughGuardian(firstName: string, ownPhone: string) {
  const registered = await world.addPatient(firstName, ownPhone);
  const added = expectOk(
    await world.organization.addGuardian(adminCaller, {
      patientId: registered.id,
      name: "Laura Gómez",
      relationship: "Madre",
      phone: numberPhone,
    }),
  );
  expectOk(
    await world.organization.setMessageContact(adminCaller, {
      patientId: registered.id,
      guardianId: added.guardian.id,
    }),
  );
  return registered;
}

/** The number writes `text`, which the model judges an opt-out, and its turn runs. */
async function numberOptsOut(text = "no me manden más mensajes") {
  await patientWrites(world.organization, text, numberPhone);
  scriptedModel.script((turn) => {
    turn.call("judge_messages", { healthQuestion: false, emergency: false, optOut: true });
    return "";
  });
  await afterTheWait(world.organization);
}

/** The outbox's rows of `appointmentId`. */
function outboxOf(appointmentId: string) {
  return inStorage(world.organization, (database) =>
    database
      .select({
        templateId: outboxMessage.templateId,
        state: outboxMessage.state,
        dropReason: outboxMessage.dropReason,
      })
      .from(outboxMessage)
      .where(eq(outboxMessage.appointmentId, appointmentId))
      .all(),
  );
}

/** The templates the object sent Meta, by name. */
function templatesSent() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map((request) => request.body as { type: string; template?: { name: string } })
    .filter((body) => body.type === "template")
    .map((body) => body.template!.name);
}

/** How many of `caller`'s notifications of `kind` there are. */
async function notificationsOf(caller: Caller, kind: string) {
  const listed = expectOk(await world.organization.listNotifications(caller));
  return listed.notifications.filter((one) => one.kind === kind).map((one) => one.patient?.id);
}

/** `caller`'s unread notifications of `kind`. */
async function unreadOf(caller: Caller, kind: string) {
  const listed = expectOk(await world.organization.listNotifications(caller));
  return listed.notifications.filter((one) => one.kind === kind && !one.read);
}

function scheduledAlarm() {
  return runInDurableObject(world.organization, (_instance, state) => state.storage.getAlarm());
}

async function pendingSince(patientId: string) {
  return expectOk(await world.organization.getPatient(adminCaller, { patientId }))
    .optOutPendingSince;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  scriptedTranscriber.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  templates = {
    confirmation: await templateNamed(world.organization, "Confirmación del turno"),
    at48: await templateNamed(world.organization, "Recordatorio con confirmación"),
    at2: await templateNamed(world.organization, "Recordatorio"),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a reply the model judges an opt-out", () => {
  it("holds every queued and new message the organization starts to each patient of the number", async () => {
    await approveConfirmation();
    await approveReminders();
    await setMessages(false, [48]);
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    const queued = await bookAt(martina.id, "12:00");

    await numberOptsOut();
    await setMessages(true, [48]);
    const booked = await bookAt(tomas.id, "12:30");
    vi.setSystemTime(+at("12:00") - 47 * hourMs);
    await runDurableObjectAlarm(world.organization);

    expect(templatesSent()).toEqual([]);
    expect((await outboxOf(queued.id)).map((row) => row.state)).toEqual(["queued"]);
    const bookedTemplates = (await outboxOf(booked.id)).map((row) => row.templateId);
    expect(bookedTemplates).toHaveLength(2);
    expect(bookedTemplates).toEqual(
      expect.arrayContaining([templates.confirmation, templates.at48]),
    );
    expect((await outboxOf(booked.id)).map((row) => row.state)).toEqual(["queued", "queued"]);
    expect(await pendingSince(martina.id)).not.toBeNull();
    expect(await pendingSince(tomas.id)).not.toBeNull();
  });

  it("still answers the patient's own messages while the number is held", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await bookAt(martina.id, "12:00");
    await numberOptsOut();
    fakeMeta.requests = [];

    await patientWrites(world.organization, "¿a qué hora es mi turno?", numberPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { healthQuestion: false, emergency: false });
      return "Tu turno es a las 9.";
    });
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: "Tu turno es a las 9." }]);
  });

  it("holds each patient of a number that reaches more of them than one statement binds", async () => {
    const patientIds = await world.addPatientsSharing(numberPhone, 100);

    await numberOptsOut();

    for (const patientId of patientIds) {
      expect(await pendingSince(patientId)).not.toBeNull();
    }
  });

  it("holds no patient whose messages go to another number", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const pedro = await world.addPatient("Pedro", "+5491155559999");

    await numberOptsOut();

    expect(await pendingSince(martina.id)).not.toBeNull();
    expect(await pendingSince(pedro.id)).toBeNull();
  });

  it("does not wake the object for the messages it holds", async () => {
    await approveConfirmation();
    await setMessages(true, []);
    const martina = await world.addPatient("Martina", numberPhone);

    await numberOptsOut();
    const optedOutAt = Date.now();
    await bookAt(martina.id, "12:00");

    // Only the daily reminder to reception wakes it.
    expect(await scheduledAlarm()).toBe(optedOutAt + dayMs);
  });
});

describe("reception keeping a patient of a held number", () => {
  it("lets that patient's held messages go, read again as they are now, and keeps the others held", async () => {
    await approveReminders();
    await setMessages(false, [48, 2]);
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    const hers = await bookAt(martina.id, "12:00");
    const his = await bookAt(tomas.id, "12:30");
    await numberOptsOut();

    vi.setSystemTime(+at("12:00") - hourMs);
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );
    await runDurableObjectAlarm(world.organization);

    // Both reminders waited, and both go: their texts name the date and time.
    expect((await outboxOf(hers.id)).map((row) => row.state)).toEqual(["sent", "sent"]);
    expect((await outboxOf(his.id)).map((row) => row.state)).toEqual(["queued", "queued"]);
    expect(await pendingSince(martina.id)).toBeNull();
    expect(await pendingSince(tomas.id)).not.toBeNull();
  });

  it("records who kept the patient", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await numberOptsOut();

    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );

    const entries = await auditEntriesFor(world.organization, martina.id);
    expect(entries.at(-1)).toMatchObject({
      action: "update",
      userId: world.receptionist.userId,
      before: { optOutPending: true },
      after: { optOutPending: false },
    });
  });
});

describe("reception turning a patient of a held number off", () => {
  it("drops their held messages and lifts their hold", async () => {
    await approveReminders();
    await setMessages(false, [48]);
    const martina = await world.addPatient("Martina", numberPhone);
    const hers = await bookAt(martina.id, "12:00");
    await numberOptsOut();

    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );

    expect(await outboxOf(hers.id)).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noConsent" }),
    ]);
    expect(await pendingSince(martina.id)).toBeNull();
  });
});

describe("a patient of a held number nobody decided on", () => {
  it("reminds reception and the admins daily on the same notification, until someone decides", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    await numberOptsOut();
    const optedOutAt = Date.now();

    vi.setSystemTime(optedOutAt + dayMs - 1);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toEqual([]);

    vi.setSystemTime(optedOutAt + dayMs);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist, "optOut")).toEqual([]);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toHaveLength(2);
    expect(await notificationsOf(adminCaller, "optOutReminder")).toEqual(
      expect.arrayContaining([martina.id, tomas.id]),
    );
    expect(await notificationsOf(world.juan.caller, "optOutReminder")).toEqual([]);

    for (const one of await unreadOf(world.receptionist, "optOutReminder")) {
      expect(one.createdAt).toBe(optedOutAt + dayMs);
      expectOk(
        await world.organization.markNotificationRead(world.receptionist, {
          notificationId: one.id,
        }),
      );
    }
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );
    vi.setSystemTime(optedOutAt + 2 * dayMs);
    await runDurableObjectAlarm(world.organization);
    // The undecided patient's notification is unread again; the decided one's stays resolved.
    expect(
      (await unreadOf(world.receptionist, "optOutReminder")).map((one) => one.patient?.id),
    ).toEqual([tomas.id]);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toHaveLength(2);
    expect(await notificationsOf(adminCaller, "optOutReminder")).toHaveLength(2);
    expect(await scheduledAlarm()).toBe(optedOutAt + 3 * dayMs);
  });
});

/** The conversation of the held number, as `caller` reads it. */
async function heldConversation(caller: Caller = world.receptionist) {
  const listed = expectOk(await world.organization.listConversations(caller, {}));
  const found = listed.conversations.find((one) => one.phone === numberPhone)!;
  return expectOk(await world.organization.readConversation(caller, { conversationId: found.id }));
}

/** The patient's message the model judged an opt-out, in the held number's conversation. */
async function optOutMessage() {
  const read = await heldConversation();
  const incoming = read.messages.filter((one) => one.direction === "incoming");
  return { conversationId: read.conversation.id, ...incoming.at(-1)! };
}

async function consentOf(patientId: string) {
  return expectOk(await world.organization.getPatient(adminCaller, { patientId })).patient
    .whatsappConsent;
}

describe("the opt-out's notification", () => {
  it("links to the patient's message that asked, once per held patient", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");

    await numberOptsOut("basta de mensajes");

    const message = await optOutMessage();
    expect(message.text).toBe("basta de mensajes");
    for (const caller of [world.receptionist, adminCaller]) {
      const listed = expectOk(await world.organization.listNotifications(caller));
      const optOuts = listed.notifications.filter((one) => one.kind === "optOut");
      expect(optOuts).toHaveLength(2);
      expect(optOuts.map((one) => one.patient?.id)).toEqual(
        expect.arrayContaining([martina.id, tomas.id]),
      );
      for (const one of optOuts) {
        expect(one).toMatchObject({
          messageId: message.id,
          conversationId: message.conversationId,
          resolved: false,
        });
      }
    }
  });
});

describe("a held patient's daily reminder", () => {
  it("leaves out a member who is no longer reception or an admin", async () => {
    await world.addPatient("Martina", numberPhone);
    const moved = (await addStaff(world.organization, "Carla Paz", ["receptionist"])).caller;
    await numberOptsOut();
    const [theirs] = await unreadOf(moved, "optOut");
    expectOk(await world.organization.markNotificationRead(moved, { notificationId: theirs!.id }));
    await inStorage(world.organization, (database) =>
      database
        .update(member)
        .set({ roles: ["practitioner"] })
        .where(eq(member.userId, moved.userId))
        .run(),
    );

    vi.setSystemTime(Date.now() + dayMs);
    await runDurableObjectAlarm(world.organization);

    expect(await unreadOf(moved, "optOutReminder")).toEqual([]);
    expect(await unreadOf(world.receptionist, "optOutReminder")).toHaveLength(1);
  });
});

describe("the opt-out under its message in the conversation", () => {
  it.each([
    ["a photo", () => patientSends(world.organization, "image", numberPhone)],
    [
      "a voice note nobody could make out",
      () => {
        scriptedTranscriber.hears("ruido", { text: "", seconds: 4 });
        return patientSpeaks(world.organization, "ruido", numberPhone);
      },
    ],
  ])(
    "sits under the patient's words when %s followed them in the same burst",
    async (_, follows) => {
      await world.addPatient("Martina", numberPhone);
      await patientWrites(world.organization, "no me manden más mensajes", numberPhone);
      await follows();
      scriptedModel.script((turn) => {
        turn.call("judge_messages", { healthQuestion: false, emergency: false, optOut: true });
        return "";
      });
      await afterTheWait(world.organization);

      const read = await heldConversation();
      const words = read.messages.find((one) => one.text === "no me manden más mensajes")!;
      expect(read.optOuts.map((one) => one.messageId)).toEqual([words.id]);
    },
  );

  it("shows each patient the number reaches, undecided, to every reader who can change consent", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    await numberOptsOut();
    const message = await optOutMessage();

    for (const caller of [world.receptionist, adminCaller]) {
      expect((await heldConversation(caller)).optOuts).toEqual([
        { messageId: message.id, patient: { id: martina.id, name: "Martina Paz" }, decision: null },
        { messageId: message.id, patient: { id: tomas.id, name: "Tomás Paz" }, decision: null },
      ]);
    }
  });

  it("keeps a patient: lifts their hold, keeps their consent, and resolves their notification only", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    await numberOptsOut();
    const message = await optOutMessage();

    vi.setSystemTime(Date.now() + hourMs);
    expectOk(
      await world.organization.decideOptOut(world.receptionist, {
        messageId: message.id,
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );

    expect(await pendingSince(martina.id)).toBeNull();
    expect(await pendingSince(tomas.id)).not.toBeNull();
    expect(await consentOf(martina.id)).toBe(true);
    expect((await heldConversation()).optOuts).toEqual([
      {
        messageId: message.id,
        patient: { id: martina.id, name: "Martina Paz" },
        decision: { kept: true, by: "Rita Paz", at: Date.now() },
      },
      { messageId: message.id, patient: { id: tomas.id, name: "Tomás Paz" }, decision: null },
    ]);
    for (const caller of [world.receptionist, adminCaller]) {
      const listed = expectOk(await world.organization.listNotifications(caller));
      const byPatient = Object.fromEntries(
        listed.notifications.map((one) => [one.patient?.id, one]),
      );
      expect(byPatient[martina.id]).toMatchObject({ resolved: true, read: true });
      expect(byPatient[tomas.id]).toMatchObject({ resolved: false, read: false });
    }
  });

  it("turns a patient off: their consent goes, and the line says so", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await numberOptsOut();
    const message = await optOutMessage();

    expectOk(
      await world.organization.decideOptOut(adminCaller, {
        messageId: message.id,
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );

    expect(await consentOf(martina.id)).toBe(false);
    expect((await heldConversation()).optOuts).toEqual([
      expect.objectContaining({
        decision: { kept: false, by: "Ana Admin", at: Date.now() },
      }),
    ]);
  });

  it("refuses a decision someone already made, from a page loaded before it, and changes nothing", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await numberOptsOut();
    const message = await optOutMessage();
    const decision = { messageId: message.id, patientId: martina.id };
    expectOk(
      await world.organization.decideOptOut(world.receptionist, {
        ...decision,
        whatsappConsent: true,
      }),
    );

    expect(
      await world.organization.decideOptOut(adminCaller, { ...decision, whatsappConsent: false }),
    ).toEqual({ ok: false, reason: "decided" });
    expect(await consentOf(martina.id)).toBe(true);
  });

  it("refuses a stranger, a deactivated member and one who must change their password, holding the patient still", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await numberOptsOut();
    const message = await optOutMessage();
    const decision = { messageId: message.id, patientId: martina.id, whatsappConsent: false };

    expect(await world.organization.decideOptOut({ userId: "user-stranger" }, decision)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    for (const state of ["deactivated", "mustChangePassword"] as const) {
      const refused = await addRefusedAdmin(world.organization, state);
      expect((await world.organization.decideOptOut(refused, decision)).ok).toBe(false);
    }
    expect(await consentOf(martina.id)).toBe(true);
    expect(await pendingSince(martina.id)).not.toBeNull();
  });

  it("shows the decision made on the patient's record, and resolves the notification", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await numberOptsOut();

    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );

    expect((await heldConversation()).optOuts).toEqual([
      expect.objectContaining({ decision: { kept: false, by: "Ana Admin", at: Date.now() } }),
    ]);
    const listed = expectOk(await world.organization.listNotifications(world.receptionist));
    expect(listed.notifications).toEqual([expect.objectContaining({ resolved: true })]);
  });
});
