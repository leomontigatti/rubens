import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addRefusedAdmin,
  addStaff,
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

// A handoff's countdown (docs/domain/assistant.md § Handoff): counted back
// from the window's close, it reminds its recipients, then every other member
// who may answer it, by the object's alarm. Meta is faked at its HTTP
// boundary and the model scripted at its port; the clock is moved by hand,
// from 18:00 in the office's zone (Buenos Aires, UTC-3).

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

const hourMs = 60 * 60_000;
const martinaPhone = "+5491155550000";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

/** Books Martina with `practitionerId` on the first Monday at `start`, UTC. */
async function bookMartina(practitionerId: string, patientId: string, start: string) {
  const medicalServiceId = (await world.addMedicalService(practitionerId)).id;
  const booked = await world.book({
    practitionerId,
    patientId,
    medicalServiceId,
    start: at(start),
    durationMinutes: 30,
    // A second appointment the same day warns, and reception goes ahead.
    confirmWarnings: true,
  });
  return booked.id;
}

/**
 * `Martina`, booked with `Juan` and with `Lucía`, writes `hoursAgo` hours ago and
 * the assistant hands the conversation to `Juan`, clinical or not. Answers
 * with when the window closes.
 */
async function handedToJuan(options: { hoursAgo: number; forPractitioner: boolean }) {
  const martina = await world.addPatient("Martina", martinaPhone);
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  await world.addSchedule({
    practitionerId: world.lucia.practitionerId,
    roomId: world.otherRoom.id,
  });
  const appointmentId = await bookMartina(world.juan.practitionerId, martina.id, "12:00");
  await bookMartina(world.lucia.practitionerId, martina.id, "13:00");
  const sentAt = Date.now() - options.hoursAgo * hourMs;
  await patientWrites(world.organization, "quiero hablar con alguien", martinaPhone, sentAt);
  const { forPractitioner } = options;
  // A handoff to reception goes to the handoff contacts: Juan is the one.
  expectOk(
    await world.organization.saveHandoffContacts(adminCaller, {
      memberIds: [world.juan.caller.userId],
    }),
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
    return "";
  });
  await afterTheWait(world.organization);
  return sentAt + 24 * hourMs;
}

/** The reminders of handoffs `caller` has, with the close each counts back from. */
async function remindersOf(caller: Caller) {
  const listed = expectOk(await world.organization.listNotifications(caller));
  return listed.notifications
    .filter((one) => one.kind === "handoffReminder")
    .map((one) => one.until);
}

async function alarmAt(instant: number) {
  vi.setSystemTime(instant);
  await runDurableObjectAlarm(world.organization);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T21:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a handoff made 20 hours before the window closes", () => {
  it("reminds its recipient 6 hours before the close, and the others 2 hours before", async () => {
    const closesAt = await handedToJuan({ hoursAgo: 4, forPractitioner: false });

    await alarmAt(closesAt - 6 * hourMs - 60_000);
    expect(await remindersOf(world.juan.caller)).toEqual([]);

    await alarmAt(closesAt - 6 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);
    expect(await remindersOf(world.receptionist)).toEqual([]);

    await alarmAt(closesAt - 2 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt, closesAt]);
    expect(await remindersOf(world.receptionist)).toEqual([closesAt]);
    expect(await remindersOf(adminCaller)).toEqual([closesAt]);
    // A practitioner it was not handed to does not read the conversation.
    expect(await remindersOf(world.lucia.caller)).toEqual([]);

    await alarmAt(closesAt + hourMs);
    expect(await remindersOf(world.juan.caller)).toHaveLength(2);
  });
});

describe("a handoff made 1 hour before the window closes", () => {
  it("reminds the others at once, but not its recipient, who was just told", async () => {
    const closesAt = await handedToJuan({ hoursAgo: 23, forPractitioner: false });

    await runDurableObjectAlarm(world.organization);

    expect(await remindersOf(world.receptionist)).toEqual([closesAt]);
    expect(await remindersOf(world.juan.caller)).toEqual([]);
    expect(await runDurableObjectAlarm(world.organization)).toBe(false);
  });
});

describe("a team of more members than one insert can bind", () => {
  it("reminds every one of them", async () => {
    const team = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        addStaff(world.organization, `Recepción ${index}`, ["receptionist"]),
      ),
    );
    const closesAt = await handedToJuan({ hoursAgo: 4, forPractitioner: false });

    await alarmAt(closesAt - 2 * hourMs);

    const reminded = await Promise.all(team.map((one) => remindersOf(one.caller)));
    expect(reminded).toEqual(team.map(() => [closesAt]));
  });
});

describe("a reminder outside 08:00 to 21:00 in the office's zone", () => {
  it("waits until 08:00", async () => {
    // Martina wrote at 09:00, so the window closes at 09:00 the next day: the
    // recipient's reminder falls at 03:00 and the others' at 07:00.
    const closesAt = await handedToJuan({ hoursAgo: 9, forPractitioner: false });
    const eightAm = closesAt - hourMs;

    await alarmAt(eightAm - 60_000);
    expect(await remindersOf(world.juan.caller)).toEqual([]);
    expect(await remindersOf(world.receptionist)).toEqual([]);

    await alarmAt(eightAm);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);
    expect(await remindersOf(world.receptionist)).toEqual([closesAt]);
  });

  it("does not go when the window closes before 08:00", async () => {
    // Martina wrote at 02:30, so the window closes at 02:30: the recipient's
    // reminder goes at 20:30, and the others' would fall at 00:30.
    const closesAt = await handedToJuan({ hoursAgo: 15.5, forPractitioner: false });

    await alarmAt(closesAt - 6 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);

    await alarmAt(closesAt - 2 * hourMs);
    await alarmAt(closesAt - 60_000);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);
    expect(await remindersOf(world.receptionist)).toEqual([]);
  });
});

describe("a change to the office's zone", () => {
  it("sets the alarm for a reminder it moves into the hours", async () => {
    // At 02:30 in Buenos Aires the window closes, so the others' reminder, at
    // 00:30, does not go; in Tokyo it falls at 12:30.
    const closesAt = await handedToJuan({ hoursAgo: 15.5, forPractitioner: false });
    await alarmAt(closesAt - 6 * hourMs);

    expectOk(
      await world.organization.updateOffice(adminCaller, {
        officeId: world.office.id,
        name: "Sede Centro",
        address: "Cabildo 1",
        timeZone: "Asia/Tokyo",
      }),
    );

    const alarm = await runInDurableObject(world.organization, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(closesAt - 2 * hourMs);
  });
});

describe("a patient's later message", () => {
  it("restarts the window, and both reminders move with it", async () => {
    const closesAt = await handedToJuan({ hoursAgo: 0, forPractitioner: false });
    vi.setSystemTime(closesAt - 3 * hourMs);
    await patientWrites(world.organization, "sigo esperando", martinaPhone);
    const newClose = Date.now() + 24 * hourMs;

    await alarmAt(closesAt - 2 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([]);
    expect(await remindersOf(world.receptionist)).toEqual([]);

    await alarmAt(newClose - 6 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([newClose]);

    await alarmAt(newClose - 2 * hourMs);
    expect(await remindersOf(world.receptionist)).toEqual([newClose]);
  });
});

describe("a clinical handoff", () => {
  it("reminds at 2 hours before the close only the practitioners who keep clinical records and read it", async () => {
    const closesAt = await handedToJuan({ hoursAgo: 4, forPractitioner: true });

    await alarmAt(closesAt - 2 * hourMs);

    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);
    expect(await remindersOf(world.lucia.caller)).toEqual([]);
    expect(await remindersOf(world.receptionist)).toEqual([]);
    expect(await remindersOf(adminCaller)).toEqual([]);
  });
});

describe("a handoff made after the window closed", () => {
  it("tells the patient nothing and has no reminders, though its recipient is told at once", async () => {
    await handedToJuan({ hoursAgo: 25, forPractitioner: false });

    expect(fakeMeta.textsSent()).toEqual([]);
    const listed = expectOk(await world.organization.listNotifications(world.juan.caller));
    expect(listed.notifications.map((one) => one.kind)).toEqual(["handoff"]);

    // The patient's next message opens a window the handoff does not count back from.
    await patientWrites(world.organization, "hola?", martinaPhone);
    const closesAt = Date.now() + 24 * hourMs;
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: false, emergency: false });
      return "";
    });
    await afterTheWait(world.organization);
    await alarmAt(closesAt - 2 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([]);
    expect(await remindersOf(world.receptionist)).toEqual([]);
  });
});

describe("the admin's reminder times", () => {
  it("move both reminders", async () => {
    expectOk(
      await world.organization.saveHandoffReminders(adminCaller, {
        recipientHours: 10,
        othersHours: 4,
      }),
    );
    const closesAt = await handedToJuan({ hoursAgo: 0, forPractitioner: false });

    await alarmAt(closesAt - 10 * hourMs);
    expect(await remindersOf(world.juan.caller)).toEqual([closesAt]);

    await alarmAt(closesAt - 4 * hourMs);
    expect(await remindersOf(world.receptionist)).toEqual([closesAt]);
    expect(
      expectOk(await world.organization.whatsappSettings(adminCaller)).handoffReminders,
    ).toEqual({ recipientHours: 10, othersHours: 4 });
  });

  it("refuses a reminder at the close", async () => {
    expect(
      await world.organization.saveHandoffReminders(adminCaller, {
        recipientHours: 6,
        othersHours: 0,
      }),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("refuses the others' reminder before the recipients'", async () => {
    expect(
      await world.organization.saveHandoffReminders(adminCaller, {
        recipientHours: 2,
        othersHours: 6,
      }),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("are the admin's alone", async () => {
    const deactivated = await addRefusedAdmin(world.organization, "deactivated");
    const mustChange = await addRefusedAdmin(world.organization, "mustChangePassword");
    const refusals = [
      [world.receptionist, "forbidden"],
      [world.juan.caller, "forbidden"],
      [{ userId: "user-nobody" }, "unauthenticated"],
      [deactivated, "unauthenticated"],
      [mustChange, "mustChangePassword"],
    ] as const;
    for (const [caller, reason] of refusals) {
      expect(
        await world.organization.saveHandoffReminders(caller, {
          recipientHours: 6,
          othersHours: 2,
        }),
      ).toEqual({ ok: false, reason });
    }
  });
});

describe("a handoff about no appointment on a number siblings share", () => {
  it("reminds its recipient without naming a patient, since it cannot tell whose", async () => {
    await world.addPatient("Martina", martinaPhone);
    // A sibling on the same number, first by name.
    expectOk(
      await world.organization.registerPatient(adminCaller, {
        firstName: "Ana",
        lastName: "Paz",
        phone: martinaPhone,
        confirmDuplicates: true,
      }),
    );
    expectOk(
      await world.organization.saveHandoffContacts(adminCaller, {
        memberIds: [world.juan.caller.userId],
      }),
    );
    await patientWrites(world.organization, "quiero sacar un turno", martinaPhone);
    const closesAt = Date.now() + 24 * hourMs;
    await afterTheWait(world.organization);

    await alarmAt(closesAt - 6 * hourMs);

    const listed = expectOk(await world.organization.listNotifications(world.juan.caller));
    expect(
      listed.notifications
        .filter((one) => one.kind === "handoffReminder")
        .map((one) => ({ reason: one.handoff?.reason, patient: one.handoff?.patient })),
    ).toEqual([{ reason: "noUpcomingAppointment", patient: null }]);
  });
});
