import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { rejectedWebhookEvent } from "#/organization/webhook-schema.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";
import {
  adminCaller,
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
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

// When the object's alarm is set: after any call that wrote, whichever method
// made it, and never after one that only read. What each job does when the
// alarm fires is its own suite's.

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
const dayMs = 24 * hourMs;

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

function alarmOf(organization: OrganizationStub) {
  return runInDurableObject(organization, (_instance, state) => state.storage.getAlarm());
}

/** Sets the object's alarm to `at`, or clears it, behind the runtime's back. */
function setAlarmOf(organization: OrganizationStub, at: number | null) {
  return runInDurableObject(organization, (_instance, state) =>
    at === null ? state.storage.deleteAlarm() : state.storage.setAlarm(at),
  );
}

beforeEach(async () => {
  // The object's clock, a month before the appointments: what it queues is
  // due then, still in the future for the runtime's own alarm scheduler.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("with a booking confirmation queued", () => {
  let confirmationId: string;
  /** When the queued confirmation is due: where the alarm belongs. */
  let dueAt: number;

  beforeEach(async () => {
    await world.addSchedule({ practitionerId: world.juan.practitionerId });
    const medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
    confirmationId = await templateNamed(world.organization, "Confirmación del turno");
    await world.pickTemplates(medicalServiceId, [confirmationId]);
    await submitTemplate(world.organization, confirmationId, {
      status: "APPROVED",
      metaId: "900000000000001",
    });
    const patient = await world.addPatient("Martina", "+5491155550000");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: patient.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    });
    const queued = await inStorage(world.organization, (database) =>
      database.select({ dueAt: outboxMessage.dueAt }).from(outboxMessage).all(),
    );
    expect(queued).toHaveLength(1);
    dueAt = queued[0]!.dueAt;
    expect(await alarmOf(world.organization)).toBe(dueAt);
  });

  it("sets the alarm again after a call that wrote, here one that adds a room", async () => {
    await setAlarmOf(world.organization, null);

    expectOk(
      await world.organization.createRoom(adminCaller, { officeId: world.office.id, name: "Box" }),
    );

    expect(await alarmOf(world.organization)).toBe(dueAt);
  });

  it("leaves the alarm as it was after reading the calendar", async () => {
    const readCalendar = () =>
      world.organization.getCalendarWeek(adminCaller, { date: "2099-01-05" });
    const elsewhere = dueAt + 24 * hourMs;
    await setAlarmOf(world.organization, elsewhere);
    expectOk(await readCalendar());
    expect(await alarmOf(world.organization)).toBe(elsewhere);

    await setAlarmOf(world.organization, null);
    expectOk(await readCalendar());
    expect(await alarmOf(world.organization)).toBeNull();
  });

  it("sets the alarm after a call that wrote and then waited on Meta, not after a read that ran meanwhile", async () => {
    const settings = expectOk(await world.organization.whatsappSettings(adminCaller));
    const listed = settings.templates.find((one) => one.id === confirmationId)!;
    const elsewhere = dueAt + 24 * hourMs;
    await setAlarmOf(world.organization, elsewhere);
    // The edit saves the template's settings, then asks Meta, which refuses:
    // nothing more is written after the wait.
    fakeMeta.answerWith(400, { error: { code: 131_000, message: "Something went wrong" } });
    const release = fakeMeta.holdNext();
    const edit = world.organization.editTemplate(adminCaller, {
      templateId: confirmationId,
      body: `${listed.draft ?? ""} Gracias.`,
      settings: { name: listed.name, timing: listed.timing! },
    });
    await fakeMeta.received(world.organization, 1);

    expectOk(await world.organization.getCalendarWeek(adminCaller, { date: "2099-01-05" }));
    expect(await alarmOf(world.organization)).toBe(elsewhere);

    release();
    expect((await edit).ok).toBe(false);
    expect(await alarmOf(world.organization)).toBe(dueAt);
  });
  it("runs the jobs after one that throws, sets the alarm no sooner than a minute on, then fails as it did", async () => {
    await world.organization.storeRejectedWebhookEvents([{ element: "{}", issues: ["from"] }]);
    vi.setSystemTime(Date.now() + 30 * dayMs);
    await patientWrites(world.organization, "hola", "+5491155550000", Date.now());
    vi.setSystemTime(Date.now() + 60_000);
    // The assistant's job throws as it starts; the retention job, the last, deletes the element.
    vi.spyOn(scriptedModel, "missingSetting").mockImplementationOnce(() => {
      throw new Error("The model could not be reached");
    });

    await expect(runDurableObjectAlarm(world.organization)).rejects.toThrow(
      "The model could not be reached",
    );

    const rejected = await inStorage(world.organization, (database) =>
      database.select().from(rejectedWebhookEvent).all(),
    );
    expect(rejected).toEqual([]);
    expect(await alarmOf(world.organization)).toBe(Date.now() + 60_000);
    // A call that writes meanwhile keeps that wait.
    expectOk(
      await world.organization.createRoom(adminCaller, { officeId: world.office.id, name: "Box" }),
    );
    expect(await alarmOf(world.organization)).toBe(Date.now() + 60_000);
  });
});
