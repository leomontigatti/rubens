import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { outboxMessage } from "#/organization/whatsapp-schema.ts";
import { jobs } from "#/organization/organization-runtime.ts";
import {
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
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

const hourMs = 60 * 60_000;

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

/** A write that queues nothing and moves no due time. */
function renameOffice() {
  return world.organization.updateOffice(adminCaller, {
    officeId: world.office.id,
    name: "Sede Norte",
    address: "Cabildo 1",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

beforeEach(async () => {
  // The object's clock, a month before the appointments: what it queues is
  // due then, still in the future for the runtime's own alarm scheduler.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it.each([
    [
      "adds a room to the office",
      () => world.organization.createRoom(adminCaller, { officeId: world.office.id, name: "Box" }),
    ],
    [
      "renames a room",
      () =>
        world.organization.updateRoom(adminCaller, {
          roomId: world.otherRoom.id,
          name: "Consultorio B",
          capacity: 1,
        }),
    ],
    ["renames the office", renameOffice],
  ])("sets the alarm again after a call that %s, which queues nothing", async (_call, call) => {
    await setAlarmOf(world.organization, null);

    expectOk(await call());

    expect(await alarmOf(world.organization)).toBe(dueAt);
  });

  it.each([
    ["the calendar", () => world.organization.getCalendarWeek(adminCaller, { date: "2099-01-05" })],
    ["the inbox", () => world.organization.listConversations(adminCaller, {})],
  ])("leaves the alarm as it was after reading %s", async (_read, read) => {
    const elsewhere = dueAt + 24 * hourMs;
    await setAlarmOf(world.organization, elsewhere);
    expectOk(await read());
    expect(await alarmOf(world.organization)).toBe(elsewhere);

    await setAlarmOf(world.organization, null);
    expectOk(await read());
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
    await fakeMeta.received(1);

    expectOk(await world.organization.getCalendarWeek(adminCaller, { date: "2099-01-05" }));
    expect(await alarmOf(world.organization)).toBe(elsewhere);

    release();
    expect((await edit).ok).toBe(false);
    expect(await alarmOf(world.organization)).toBe(dueAt);
  });
});

describe("the jobs", () => {
  it.each(jobs.map((job) => [job.name, job] as const))(
    "runs %s when the alarm fires at the time it gave",
    async (_name, job) => {
      const due = Date.now() + hourMs;
      vi.spyOn(job, "nextDue").mockReturnValue(due);
      const run = vi.spyOn(job, "run").mockReturnValue(undefined);

      expectOk(await renameOffice());
      expect(await alarmOf(world.organization)).toBe(due);
      vi.setSystemTime(due);
      await runDurableObjectAlarm(world.organization);

      expect(run).toHaveBeenCalled();
    },
  );
});
