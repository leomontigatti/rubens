import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { assistantWaitMs } from "#/lib/assistant.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";

// Replies that look like opt-outs (docs/domain/messages.md § To staff):
// the assistant's turn notifies reception and the admins with the patient,
// tells the patient the practice stops writing, and once a person turns the
// patient's WhatsApp consent off, the outbox starts nothing more for them.
// Meta is faked at its HTTP boundary and the model scripted at its port.

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

const optedOutText =
  "Entendido. Le avisamos al equipo para que no te enviemos más mensajes por WhatsApp.";

const optOut = { needsPractitioner: false, emergency: false, optOut: true };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

/** Books `patientId` with Juan on the first Monday at `time` in Buenos Aires. */
function bookAt(patientId: string, time: string) {
  return world.book({
    practitionerId: world.juan.practitionerId,
    patientId,
    medicalServiceId,
    start: at(time),
    durationMinutes: 30,
    // A second appointment of the same patient that day is only a warning.
    confirmWarnings: true,
  });
}

/** Makes the guardian on `martinaPhone` the message contact of `patientId`. */
async function makeGuardianContact(patientId: string) {
  const added = expectOk(
    await world.organization.addGuardian(adminCaller, {
      patientId,
      name: "Laura Gómez",
      relationship: "Madre",
      phone: martinaPhone,
    }),
  );
  expectOk(
    await world.organization.setMessageContact(adminCaller, {
      patientId,
      guardianId: added.guardian.id,
    }),
  );
}

/** The patients `caller`'s opt-out notifications are about. */
async function optOutsNotified(caller: Caller) {
  const listed = expectOk(await world.organization.listNotifications(caller));
  return listed.notifications.filter((one) => one.kind === "optOut").map((one) => one.patient);
}

function scheduledAlarm() {
  return runInDurableObject(world.organization, (_instance, state) => state.storage.getAlarm());
}

function outbox() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        appointmentId: outboxMessage.appointmentId,
        templateId: outboxMessage.templateId,
        state: outboxMessage.state,
        dropReason: outboxMessage.dropReason,
      })
      .from(outboxMessage)
      .all(),
  );
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
  it("notifies reception and the admins with the patient, and tells the patient the practice stops writing", async () => {
    const martina = await world.addPatient("Martina", martinaPhone);
    await bookAt(martina.id, "12:00");
    await patientWrites(world.organization, "no me manden más mensajes", martinaPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", optOut);
      return "Dale, no te escribimos más.";
    });

    await afterTheWait(world.organization);

    const patient = { id: martina.id, name: "Martina Paz" };
    expect(await optOutsNotified(world.receptionist)).toEqual([patient]);
    expect(await optOutsNotified(adminCaller)).toEqual([patient]);
    expect(await optOutsNotified(world.juan.caller)).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: optedOutText }]);
    expect(expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs).toEqual(
      [],
    );
  });

  it("names each patient of the number who still has consent, without handing off for nothing booked", async () => {
    const martina = await world.addPatient("Martina", "+5493515550001");
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    const ana = await world.addPatient("Ana", "+5493515550003");
    for (const one of [martina, tomas, ana]) {
      await makeGuardianContact(one.id);
    }
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: ana.id,
        whatsappConsent: false,
      }),
    );
    await patientWrites(world.organization, "basta de mensajes", martinaPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", optOut);
      return "";
    });

    await afterTheWait(world.organization);

    const notified = await optOutsNotified(world.receptionist);
    expect(notified).toHaveLength(2);
    expect(notified).toEqual(
      expect.arrayContaining([
        { id: martina.id, name: "Martina Paz" },
        { id: tomas.id, name: "Tomás Paz" },
      ]),
    );
    expect(expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs).toEqual(
      [],
    );
    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: optedOutText }]);
  });

  it("notifies no one again while their earlier notification is unread, and those who read it again", async () => {
    const martina = await world.addPatient("Martina", martinaPhone);
    await bookAt(martina.id, "12:00");
    const optsOut = async (text: string) => {
      await patientWrites(world.organization, text, martinaPhone);
      scriptedModel.script((turn) => {
        turn.call("judge_messages", optOut);
        return "";
      });
      await afterTheWait(world.organization);
    };
    await optsOut("no me manden más mensajes");
    const [read] = expectOk(
      await world.organization.listNotifications(world.receptionist),
    ).notifications;
    expectOk(
      await world.organization.markNotificationRead(world.receptionist, {
        notificationId: read!.id,
      }),
    );

    await optsOut("basta");

    const patient = { id: martina.id, name: "Martina Paz" };
    expect(await optOutsNotified(adminCaller)).toEqual([patient]);
    expect(await optOutsNotified(world.receptionist)).toEqual([patient, patient]);
    expect(fakeMeta.textsSent().map((one) => one.text)).toEqual([optedOutText, optedOutText]);
  });

  it("names and holds no patient whose messages reception sent elsewhere while the model wrote, and hands the number off", async () => {
    const martina = await world.addPatient("Martina", "+5493515550001");
    await makeGuardianContact(martina.id);
    await bookAt(martina.id, "12:00");
    await patientWrites(world.organization, "no me escriban más", martinaPhone);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    scriptedModel.script(async (turn) => {
      turn.call("judge_messages", optOut);
      await released;
      return "";
    });
    vi.setSystemTime(Date.now() + assistantWaitMs);
    const alarm = runDurableObjectAlarm(world.organization);
    while (scriptedModel.turns.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expectOk(
      await world.organization.setMessageContact(adminCaller, {
        patientId: martina.id,
        guardianId: null,
      }),
    );
    release();
    await alarm;

    expect(await optOutsNotified(world.receptionist)).toEqual([]);
    const shown = expectOk(
      await world.organization.getPatient(adminCaller, { patientId: martina.id }),
    );
    expect(shown.optOutPendingSince).toBeNull();
    // Nobody is left on the number to turn off: a person answers it.
    const [opened] = expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
    expect(opened).toMatchObject({ reason: "unknownNumber" });
  });

  it("hands off a number of no patient, since there is no consent to turn off", async () => {
    await patientWrites(world.organization, "no me escriban más", "+5493515550123");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", optOut);
      return "";
    });

    await afterTheWait(world.organization);

    expect(await optOutsNotified(world.receptionist)).toEqual([]);
    const [opened] = expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
    expect(opened).toMatchObject({ reason: "unknownNumber" });
  });

  it("still hands a clinical message off, with the handoff's reply", async () => {
    const martina = await world.addPatient("Martina", martinaPhone);
    await bookAt(martina.id, "12:00");
    await patientWrites(world.organization, "me duele mucho, no me escriban más", martinaPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { ...optOut, needsPractitioner: true });
      return "";
    });

    await afterTheWait(world.organization);

    expect(await optOutsNotified(world.receptionist)).toEqual([
      { id: martina.id, name: "Martina Paz" },
    ]);
    const [opened] = expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
    expect(opened).toMatchObject({ reason: "clinical", forPractitioner: true });
    expect(fakeMeta.textsSent()).toEqual([
      {
        to: "5491155550000",
        text: "Gracias por escribirnos. Le pasamos tu mensaje a una persona del equipo, que te va a responder por acá.",
      },
    ]);
  });
});

describe("a patient whose consent a person turned off", () => {
  it("gets none of their queued messages, and none queued after", async () => {
    // The medical service sends the booking confirmation, approved.
    const confirmationId = await templateNamed(world.organization, "Confirmación del turno");
    await submitTemplate(world.organization, confirmationId, {
      status: "APPROVED",
      metaId: "900000000000030",
    });
    await world.pickTemplates(medicalServiceId, [confirmationId]);
    const martina = await world.addPatient("Martina", martinaPhone);
    const pedro = await world.addPatient("Pedro", "+5491155559999");
    const queued = await bookAt(martina.id, "12:00");
    const others = await bookAt(pedro.id, "12:30");

    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );
    const later = await bookAt(martina.id, "13:00");
    await runDurableObjectAlarm(world.organization);

    const rows = await outbox();
    expect(rows.filter((row) => row.appointmentId === queued.id)).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noConsent" }),
    ]);
    expect(rows.filter((row) => row.appointmentId === later.id)).toEqual([]);
    expect(rows.filter((row) => row.appointmentId === others.id)).not.toEqual([]);
    expect(
      rows.filter((row) => row.appointmentId === others.id && row.dropReason === "noConsent"),
    ).toEqual([]);
  });

  it("gets their upcoming appointments' reminders again once consent is back on, with the alarm set for them", async () => {
    const reminderId = await templateNamed(world.organization, "Recordatorio con confirmación");
    await submitTemplate(world.organization, reminderId, {
      status: "APPROVED",
      metaId: "900000000000031",
      timing: { when: "before", hours: 48 },
    });
    await world.pickTemplates(medicalServiceId, [reminderId]);
    const martina = await world.addPatient("Martina", martinaPhone);
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: false,
      }),
    );
    const booked = await bookAt(martina.id, "12:00");
    expect(await scheduledAlarm()).toBeNull();
    expectOk(
      await world.organization.setWhatsappConsent(world.receptionist, {
        patientId: martina.id,
        whatsappConsent: true,
      }),
    );

    const queued = (await outbox()).filter(
      (row) => row.appointmentId === booked.id && row.state === "queued",
    );
    expect(queued).toEqual([expect.objectContaining({ templateId: reminderId })]);
    expect(await scheduledAlarm()).toBe(+at("12:00") - 48 * 60 * 60_000);
  });
});
