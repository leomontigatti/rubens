import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { whatsappTemplates } from "#/lib/whatsapp-templates.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  afterTheWait,
  at,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
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

const numberPhone = "+5491155550000";

const hourMs = 60 * 60_000;
const dayMs = 24 * hourMs;

const confirmationBody =
  "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

/** Has Meta approve `templateName` with `body` at once. */
async function approve(templateName: "confirmacion_turno" | "recordatorio_turno", body: string) {
  fakeMeta.answerNextWith(200, {
    id: templateName === "confirmacion_turno" ? "900000000000041" : "900000000000042",
    status: "APPROVED",
    category: "UTILITY",
  });
  expectOk(await world.organization.submitWhatsappTemplate(adminCaller, { templateName, body }));
}

/** Sets the medical service's booking confirmation and its reminders, `hours` before. */
async function setMessages(bookingConfirmation: boolean, hours: number[]) {
  expectOk(
    await world.organization.updateMedicalService(adminCaller, {
      medicalServiceId,
      name: "Consulta",
      durationMinutes: 30,
      bookingConfirmation,
      reminders: hours.map((hoursBefore) => ({ hoursBefore, asksToConfirm: true })),
      careInstructions: null,
      followUpHours: null,
      rescheduleCutoffHours: 24,
    }),
  );
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
    turn.call("judge_messages", { clinical: false, emergency: false, optOut: true });
    return "";
  });
  await afterTheWait(world.organization);
}

/** The outbox's rows of `appointmentId`. */
function outboxOf(appointmentId: string) {
  return inStorage(world.organization, (database) =>
    database
      .select({
        kind: outboxMessage.kind,
        hoursBefore: outboxMessage.hoursBefore,
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
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a reply the model judges an opt-out", () => {
  it("holds every queued and new message the organization starts to each patient of the number", async () => {
    await approve("confirmacion_turno", confirmationBody);
    await approve(
      "recordatorio_turno",
      whatsappTemplates.recordatorio_turno.draft.replace("[firma]", "Consultorios Prueba"),
    );
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
    // A save of the medical service queues the reminders afresh: the latest are queued still.
    expect((await outboxOf(queued.id)).map((row) => row.state)).toContain("queued");
    expect((await outboxOf(booked.id)).map((row) => row.kind)).toEqual([
      "bookingConfirmation",
      "reminder",
    ]);
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
      turn.call("judge_messages", { clinical: false, emergency: false });
      return "Tu turno es a las 9.";
    });
    await afterTheWait(world.organization);

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: "Tu turno es a las 9." }]);
  });

  it("holds no patient whose messages go to another number", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const pedro = await world.addPatient("Pedro", "+5491155559999");

    await numberOptsOut();

    expect(await pendingSince(martina.id)).not.toBeNull();
    expect(await pendingSince(pedro.id)).toBeNull();
  });

  it("does not wake the object for the messages it holds", async () => {
    await approve("confirmacion_turno", confirmationBody);
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
    await approve(
      "recordatorio_turno",
      whatsappTemplates.recordatorio_turno.draft.replace("[firma]", "Consultorios Prueba"),
    );
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

    // The 48-hour reminder was overtaken by the 2-hour one while it waited.
    const rows = await outboxOf(hers.id);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hoursBefore: 48, state: "dropped", dropReason: "overtaken" }),
        expect.objectContaining({ hoursBefore: 2, state: "sent" }),
      ]),
    );
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
  it("reminds reception and the admins daily, until someone decides", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    await numberOptsOut();
    const optedOutAt = Date.now();

    vi.setSystemTime(optedOutAt + dayMs - 1);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toEqual([]);

    vi.setSystemTime(optedOutAt + dayMs);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toHaveLength(2);
    expect(await notificationsOf(adminCaller, "optOutReminder")).toEqual(
      expect.arrayContaining([martina.id, tomas.id]),
    );
    expect(await notificationsOf(world.juan.caller, "optOutReminder")).toEqual([]);

    for (const one of await unreadOf(world.receptionist, "optOutReminder")) {
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
    // A member who has not read the day's reminder is not told again.
    expect(
      (await unreadOf(world.receptionist, "optOutReminder")).map((one) => one.patient?.id),
    ).toEqual([tomas.id]);
    expect(await notificationsOf(adminCaller, "optOutReminder")).toHaveLength(2);
    expect(await scheduledAlarm()).toBe(optedOutAt + 3 * dayMs);
  });
});

describe("an opt-out among words reception cannot read", () => {
  /** Martina, booked with Juan, writes `text`; the model never reads it, and it is handed off. */
  async function unreadAndHandedOff(text: string) {
    const martina = await world.addPatient("Martina", numberPhone);
    await bookAt(martina.id, "12:00");
    const sentAt = Date.now();
    await patientWrites(world.organization, text, numberPhone);
    for (let i = 0; i < 100; i += 1) {
      scriptedModel.script(() => {
        throw new Error("The model is overloaded");
      });
    }
    await afterTheWait(world.organization);
    const handOffAt = sentAt + 18 * hourMs;
    while (Date.now() < handOffAt) {
      vi.setSystemTime(Math.min(Date.now() + hourMs, handOffAt));
      await runDurableObjectAlarm(world.organization);
    }
    const [handedOff] = expectOk(
      await world.organization.listOpenHandoffs(world.juan.caller, {}),
    ).handoffs;
    expect(handedOff).toMatchObject({ reason: "modelUnavailable", optOut: "mayReport" });
    return { martina, handoffId: handedOff!.id };
  }

  async function openHandoffOf(caller: Caller) {
    return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs[0];
  }

  it("holds the number and notifies reception and the admins once the handoff's reader reports it", async () => {
    const tomas = await addThroughGuardian("Tomás", "+5493515550002");
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más por acá");

    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));

    expect(await pendingSince(martina.id)).not.toBeNull();
    expect(await pendingSince(tomas.id)).not.toBeNull();
    expect(await notificationsOf(world.receptionist, "optOut")).toEqual(
      expect.arrayContaining([martina.id, tomas.id]),
    );
    expect(await notificationsOf(adminCaller, "optOut")).toHaveLength(2);
    // The handoff stays open: the patient may still have something to answer.
    expect(await openHandoffOf(world.juan.caller)).toMatchObject({ optOut: "reported" });
    vi.setSystemTime(Date.now() + dayMs);
    await runDurableObjectAlarm(world.organization);
    expect(await notificationsOf(world.receptionist, "optOutReminder")).toHaveLength(2);
  });

  it("records who reported it", async () => {
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más");

    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));

    const entries = await auditEntriesFor(world.organization, martina.id);
    expect(entries.at(-1)).toMatchObject({
      action: "update",
      userId: world.juan.caller.userId,
      before: { optOutPending: false },
      after: { optOutPending: true },
    });
  });

  it("is reported only by a practitioner who keeps clinical records", async () => {
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más");

    expect(await world.organization.reportOptOut(world.receptionist, { handoffId })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await openHandoffOf(world.receptionist)).toMatchObject({ optOut: null });
    expect(await pendingSince(martina.id)).toBeNull();
  });

  it("is offered on a clinical handoff the model read too, whose words reception cannot read", async () => {
    const martina = await world.addPatient("Martina", numberPhone);
    await bookAt(martina.id, "12:00");
    await patientWrites(world.organization, "me duele mucho, y no me escriban más", numberPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { clinical: true, emergency: false });
      return "";
    });
    await afterTheWait(world.organization);
    const handedOff = await openHandoffOf(world.juan.caller);
    expect(handedOff).toMatchObject({ reason: "clinical", optOut: "mayReport" });

    expectOk(
      await world.organization.reportOptOut(world.juan.caller, { handoffId: handedOff!.id }),
    );

    expect(await pendingSince(martina.id)).not.toBeNull();
  });

  it("is not offered on a handoff reception reads", async () => {
    await patientWrites(world.organization, "hola, ¿quién habla?", "+5493515550999");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { clinical: false, emergency: false });
      return "";
    });
    await afterTheWait(world.organization);
    const handedOff = await openHandoffOf(adminCaller);
    expect(handedOff).toMatchObject({ reason: "unknownNumber", optOut: null });

    expect(
      await world.organization.reportOptOut(adminCaller, { handoffId: handedOff!.id }),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("is reported once for the same messages, so reception's decision stands", async () => {
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más");
    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );

    expect(await openHandoffOf(world.juan.caller)).toMatchObject({ optOut: "reported" });
    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));

    expect(await pendingSince(martina.id)).toBeNull();
    expect(await notificationsOf(world.receptionist, "optOut")).toEqual([martina.id]);
  });

  it("can be reported again once the patient writes again", async () => {
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más");
    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );
    vi.setSystemTime(Date.now() + 60_000);
    // The model is still failing: the new message joins the open handoff unread.
    await patientWrites(world.organization, "en serio, dejen de escribirme", numberPhone);

    expect(await openHandoffOf(world.juan.caller)).toMatchObject({ optOut: "mayReport" });
    expectOk(await world.organization.reportOptOut(world.juan.caller, { handoffId }));

    expect(await pendingSince(martina.id)).not.toBeNull();
  });

  it("is refused when no patient of the number accepts WhatsApp", async () => {
    const { martina, handoffId } = await unreadAndHandedOff("no me escriban más");
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );

    expect(await world.organization.reportOptOut(world.juan.caller, { handoffId })).toEqual({
      ok: false,
      reason: "nobodyToTurnOff",
    });
    expect(await notificationsOf(world.receptionist, "optOut")).toEqual([]);
  });
});
