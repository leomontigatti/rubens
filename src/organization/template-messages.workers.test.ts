import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { metaTemplateName } from "#/lib/whatsapp-templates.ts";
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
import { outboxMessage } from "#/organization/whatsapp-schema.ts";

// When the messages of the organization's own templates are queued, rebuilt
// and dropped (docs/domain/messages.md § The organization's templates), read
// through the outbox's rows and what the alarm sends.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const hours = (count: number) => count * 60 * 60_000;

/** Martina's appointment: 09:00 in Buenos Aires on Monday, 30 minutes. */
const nineOnMonday = at("12:00");
const endsAt = +nineOnMonday + 30 * 60_000;

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
/** The drafts every organization starts with. */
let drafts: { confirmation: string; dayBefore: string; twoHoursBefore: string; followUp: string };

/** Has Meta approve template `templateId` at once, as `metaId`. */
function approve(templateId: string, metaId: string) {
  return submitTemplate(world.organization, templateId, { status: "APPROVED", metaId });
}

/** Meta reports the version `metaId` moved to `status`. */
async function metaTurns(metaId: string, status: "approved" | "paused") {
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [],
      statuses: [],
      templateStatuses: [{ metaId, status, reason: null }],
    }),
  );
}

/** Every outbox row, in the order it was queued. */
function outbox() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        templateId: outboxMessage.templateId,
        dueAt: outboxMessage.dueAt,
        state: outboxMessage.state,
        dropReason: outboxMessage.dropReason,
      })
      .from(outboxMessage)
      .all(),
  );
}

/** The queued rows, as their template and when each is due. */
async function queued() {
  return (await outbox())
    .filter((row) => row.state === "queued")
    .map(({ templateId, dueAt }) => ({ templateId, dueAt }));
}

/** The Meta name of each message the object sent, in order. */
function sentTemplates() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map((request) => (request.body as { template: { name: string } }).template.name);
}

async function bookMartina() {
  const patient = await world.addPatient("Martina", "+5491155550000");
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start: nineOnMonday,
    durationMinutes: 30,
  });
  return { patient, appointmentId: booked.id };
}

/** Changes the timing of template `templateId`, keeping its text: no new version. */
async function retime(templateId: string, timing: { when: "before" | "after"; hours: number }) {
  const listed = expectOk(await world.organization.whatsappSettings(adminCaller));
  const current = listed.templates.find((one) => one.id === templateId)!;
  expectOk(
    await world.organization.editTemplate(adminCaller, {
      templateId,
      body: current.versions[0]!.body,
      settings: { name: current.name, timing },
    }),
  );
}

async function setConsent(patientId: string, whatsappConsent: boolean) {
  expectOk(
    await world.organization.setWhatsappConsent(adminCaller, { patientId, whatsappConsent }),
  );
}

async function markAttended(appointmentId: string) {
  expectOk(
    await world.organization.changeAppointmentStatus(adminCaller, {
      appointmentId,
      status: "attended",
    }),
  );
}

beforeEach(async () => {
  // A month before the appointments, so the runtime's own alarm never fires first.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  drafts = {
    confirmation: await templateNamed(world.organization, "Confirmación del turno"),
    dayBefore: await templateNamed(world.organization, "Recordatorio con confirmación"),
    twoHoursBefore: await templateNamed(world.organization, "Recordatorio"),
    followUp: await templateNamed(world.organization, "Seguimiento"),
  };
  fakeMeta.answerWith(200, {
    messaging_product: "whatsapp",
    contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
    messages: [{ id: "wamid.sent" }],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a template Meta has not approved", () => {
  it("queues nothing for an appointment, picked or not, until Meta approves one of its versions", async () => {
    await world.pickTemplates(medicalServiceId, [drafts.confirmation, drafts.dayBefore]);
    await submitTemplate(world.organization, drafts.dayBefore, {
      status: "PENDING",
      metaId: "900000000000011",
    });

    await bookMartina();

    expect(await outbox()).toEqual([]);
  });

  it("queues, once approved, what is still ahead of the appointments booked before, and no booking confirmation late", async () => {
    await world.pickTemplates(medicalServiceId, [
      drafts.confirmation,
      drafts.dayBefore,
      drafts.twoHoursBefore,
    ]);
    for (const [templateId, metaId] of [
      [drafts.confirmation, "900000000000010"],
      [drafts.dayBefore, "900000000000011"],
      [drafts.twoHoursBefore, "900000000000012"],
    ] as const) {
      await submitTemplate(world.organization, templateId, { status: "PENDING", metaId });
    }
    await bookMartina();
    vi.setSystemTime(+nineOnMonday - hours(12));

    for (const metaId of ["900000000000010", "900000000000011", "900000000000012"]) {
      await metaTurns(metaId, "approved");
    }

    expect(await queued()).toEqual([
      { templateId: drafts.twoHoursBefore, dueAt: +nineOnMonday - hours(2) },
    ]);
  });

  it("still queues one whose only approved version Meta paused since: its messages wait", async () => {
    await world.pickTemplates(medicalServiceId, [drafts.dayBefore]);
    await approve(drafts.dayBefore, "900000000000011");
    await metaTurns("900000000000011", "paused");

    await bookMartina();

    expect(await queued()).toEqual([
      { templateId: drafts.dayBefore, dueAt: +nineOnMonday - hours(24) },
    ]);
  });
});

describe("a change of a template's timing", () => {
  beforeEach(async () => {
    await world.pickTemplates(medicalServiceId, [drafts.dayBefore]);
    await approve(drafts.dayBefore, "900000000000011");
  });

  it("queues its messages still ahead again, at the new time, and submits nothing to Meta", async () => {
    await bookMartina();

    await retime(drafts.dayBefore, { when: "before", hours: 48 });

    expect(await queued()).toEqual([
      { templateId: drafts.dayBefore, dueAt: +nineOnMonday - hours(48) },
    ]);
    expect(await outbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dueAt: +nineOnMonday - hours(24), state: "dropped" }),
      ]),
    );
    expect(fakeMeta.requests).toEqual([]);
  });

  it("leaves a message already due and waiting as it is, with no second one for its appointment", async () => {
    await bookMartina();
    await metaTurns("900000000000011", "paused");
    vi.setSystemTime(+nineOnMonday - hours(20));
    await runDurableObjectAlarm(world.organization);

    await retime(drafts.dayBefore, { when: "before", hours: 2 });

    expect(await queued()).toEqual([
      { templateId: drafts.dayBefore, dueAt: +nineOnMonday - hours(24) },
    ]);
  });

  it("queues nothing ahead once the template goes after the appointment, until it is attended", async () => {
    await bookMartina();

    await retime(drafts.dayBefore, { when: "after", hours: 24 });

    expect(await queued()).toEqual([]);
  });
});

describe("a change of the templates a medical service sends", () => {
  beforeEach(async () => {
    await approve(drafts.dayBefore, "900000000000011");
  });

  it("queues a newly picked template's messages still ahead of the appointments already booked", async () => {
    await bookMartina();
    expect(await outbox()).toEqual([]);

    await world.pickTemplates(medicalServiceId, [drafts.dayBefore]);

    expect(await queued()).toEqual([
      { templateId: drafts.dayBefore, dueAt: +nineOnMonday - hours(24) },
    ]);
  });

  it("drops a template's messages, a due one waiting included, once it no longer sends it", async () => {
    await world.pickTemplates(medicalServiceId, [drafts.dayBefore]);
    await bookMartina();
    await metaTurns("900000000000011", "paused");
    vi.setSystemTime(+nineOnMonday - hours(20));
    await runDurableObjectAlarm(world.organization);

    await world.pickTemplates(medicalServiceId, []);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "templateUnpicked" }),
    ]);

    await metaTurns("900000000000011", "approved");
    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([]);
  });
});

describe("a patient's WhatsApp consent", () => {
  beforeEach(async () => {
    await world.pickTemplates(medicalServiceId, [drafts.dayBefore]);
    await approve(drafts.dayBefore, "900000000000011");
  });

  it("drops a message due and waiting once it is turned off, so it does not go when Meta allows it", async () => {
    const { patient } = await bookMartina();
    await metaTurns("900000000000011", "paused");
    vi.setSystemTime(+nineOnMonday - hours(20));
    await runDurableObjectAlarm(world.organization);

    await setConsent(patient.id, false);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noConsent" }),
    ]);

    await metaTurns("900000000000011", "approved");
    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([]);
  });

  it("queues again what is still ahead once it is turned back on", async () => {
    const { patient } = await bookMartina();
    await setConsent(patient.id, false);

    await setConsent(patient.id, true);

    expect(await queued()).toEqual([
      { templateId: drafts.dayBefore, dueAt: +nineOnMonday - hours(24) },
    ]);
  });
});

describe("templates on and after the appointment's attendance", () => {
  beforeEach(async () => {
    await world.pickTemplates(medicalServiceId, [drafts.followUp]);
    await approve(drafts.followUp, "900000000000014");
  });

  it("queues one timed after the appointment when it is marked attended, its hours after the end", async () => {
    const { appointmentId } = await bookMartina();
    expect(await outbox()).toEqual([]);

    await markAttended(appointmentId);

    expect(await queued()).toEqual([{ templateId: drafts.followUp, dueAt: endsAt + hours(24) }]);
  });

  it("drops it when marking the appointment attended is undone", async () => {
    const { appointmentId } = await bookMartina();
    await markAttended(appointmentId);

    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    expect(await queued()).toEqual([]);
  });

  it("sends nothing for an appointment never marked attended", async () => {
    await bookMartina();

    vi.setSystemTime(endsAt + hours(25));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([]);
  });

  it("sends one timed at the attendance at once, and still sends it weeks late while Meta paused it", async () => {
    const created = expectOk(
      await (async () => {
        fakeMeta.answerNextWith(200, {
          id: "900000000000015",
          status: "APPROVED",
          category: "UTILITY",
        });
        return world.organization.createTemplate(adminCaller, {
          name: "Indicaciones de limpieza",
          timing: { when: "attended" },
          body: "Hola {{paciente}}, no comas por 2 horas después de tu turno del {{fecha}}. Consultorios Prueba",
        });
      })(),
    );
    await world.pickTemplates(medicalServiceId, [created.templateId]);
    const { appointmentId } = await bookMartina();
    await metaTurns("900000000000015", "paused");
    vi.setSystemTime(endsAt);
    await markAttended(appointmentId);
    expect(await queued()).toEqual([{ templateId: created.templateId, dueAt: endsAt }]);

    vi.setSystemTime(endsAt + hours(24 * 21));
    await metaTurns("900000000000015", "approved");
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([metaTemplateName(created.templateId, 1)]);
  });
});

describe("several late messages of one appointment", () => {
  it("each go, in the order of their times", async () => {
    await world.pickTemplates(medicalServiceId, [drafts.dayBefore, drafts.twoHoursBefore]);
    await approve(drafts.dayBefore, "900000000000011");
    await approve(drafts.twoHoursBefore, "900000000000012");
    await bookMartina();
    for (const id of ["wamid.first", "wamid.second"]) {
      fakeMeta.answerNextWith(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
        messages: [{ id }],
      });
    }

    vi.setSystemTime(+nineOnMonday - hours(1));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([
      metaTemplateName(drafts.dayBefore, 1),
      metaTemplateName(drafts.twoHoursBefore, 1),
    ]);
  });
});

describe("moving an appointment", () => {
  it("replaces its messages before the appointment with those for its new time", async () => {
    await world.pickTemplates(medicalServiceId, [drafts.confirmation, drafts.dayBefore]);
    await approve(drafts.confirmation, "900000000000010");
    await approve(drafts.dayBefore, "900000000000011");
    const { appointmentId } = await bookMartina();
    const nextMonday = at("12:00", "2099-01-12");

    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: nextMonday,
        durationMinutes: 30,
      }),
    );

    // The booking confirmation stays; the move also tells the patient (`turno_movido`).
    expect(await queued()).toEqual([
      { templateId: drafts.confirmation, dueAt: Date.now() },
      { templateId: drafts.dayBefore, dueAt: +nextMonday - hours(24) },
      { templateId: "turno_movido", dueAt: Date.now() },
    ]);
  });
});
