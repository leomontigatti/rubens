import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  answeringNotice,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";
import { metaTemplateName } from "#/lib/whatsapp-templates.ts";

// The messages for an appointment the organization changed: moved or
// cancelled by staff, or sent to the "to reschedule" list by time off, a
// closure or a schedule change. The office is in Buenos Aires (UTC-3), so
// 09:00 there is 12:00Z; 2099-01-05 and 2099-01-12 are Mondays, and Juan works
// from 09:00 to 11:00 every Monday from the first.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
let juanScheduleId: string;

beforeEach(async () => {
  // A month before the appointments: what is queued stays in the future for
  // the runtime's own alarm scheduler, so the alarm fires only when run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  juanScheduleId = (await world.addSchedule({ practitionerId: world.juan.practitionerId })).id;
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The outbox's messages about an appointment the organization changed. */
function changeMessages() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        kind: outboxMessage.kind,
        appointmentId: outboxMessage.appointmentId,
        state: outboxMessage.state,
        dropReason: outboxMessage.dropReason,
      })
      .from(outboxMessage)
      .all()
      .filter((row) =>
        ["appointmentMoved", "appointmentCancelled", "appointmentToReschedule"].includes(row.kind),
      ),
  );
}

/** Books a patient of the given name at `start`, Juan's first Monday at 09:00 unless given. */
async function bookPatient(firstName: string, phone: string, start = at("12:00")) {
  const patient = await world.addPatient(firstName, phone);
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start,
    durationMinutes: 30,
  });
  return booked.id;
}

const bookMartina = () => bookPatient("Martina", "+5491155550000");

function reschedule(appointmentId: string, start = at("12:00", "2099-01-12")) {
  return world.organization.rescheduleAppointment(adminCaller, {
    appointmentId,
    start,
    durationMinutes: 30,
  });
}

describe("telling the patient their appointment was moved", () => {
  it("queues `turno_movido` when staff move the appointment", async () => {
    const appointmentId = await bookMartina();

    expectOk(await reschedule(appointmentId));

    expect(await changeMessages()).toEqual([
      { kind: "appointmentMoved", appointmentId, state: "queued", dropReason: null },
    ]);
  });
});

function cancel(appointmentId: string, cancelledBy: "business" | "patient") {
  return world.organization.cancelAppointment(adminCaller, { appointmentId, cancelledBy });
}

describe("telling the patient their appointment was cancelled", () => {
  it("queues `turno_cancelado` when staff cancel it, by the business", async () => {
    const appointmentId = await bookMartina();

    expectOk(await cancel(appointmentId, "business"));

    expect(await changeMessages()).toEqual([
      { kind: "appointmentCancelled", appointmentId, state: "queued", dropReason: null },
    ]);
  });

  it("queues nothing for a cancellation by the patient", async () => {
    const appointmentId = await bookMartina();

    expectOk(await cancel(appointmentId, "patient"));

    expect(await changeMessages()).toEqual([]);
  });

  it("replaces a queued `turno_movido` when the moved appointment is then cancelled", async () => {
    const appointmentId = await bookMartina();
    expectOk(await reschedule(appointmentId));

    expectOk(await cancel(appointmentId, "business"));

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentMoved", state: "dropped" }),
      expect.objectContaining({ kind: "appointmentCancelled", state: "queued" }),
    ]);
  });
});

const firstMondayMorning = {
  kind: "hours",
  start: "2099-01-05T09:00",
  end: "2099-01-05T10:00",
} as const;

/** Juan's time off on the first Monday from 09:00 to 10:00, telling the patients unless asked not to. */
async function addTimeOff(tellPatients = true) {
  return expectOk(
    await answeringNotice(tellPatients, (notice) =>
      world.organization.createTimeOff(adminCaller, {
        practitionerId: world.juan.practitionerId,
        entry: firstMondayMorning,
        ...notice,
      }),
    ),
  ).timeOff;
}

describe("asking whether to tell the patients a time off or a closure sends to the list", () => {
  const createTimeOff = (notice: { tellPatients?: boolean; affected?: number } = {}) =>
    world.organization.createTimeOff(adminCaller, {
      practitionerId: world.juan.practitionerId,
      entry: firstMondayMorning,
      ...notice,
    });

  const listedCount = async () =>
    expectOk(await world.organization.countToReschedule(adminCaller)).count;

  it("saves at once, asking nothing, when it sends no appointment to the list", async () => {
    await bookPatient("Martina", "+5491155550000", at("13:30"));

    expect(await createTimeOff()).toMatchObject({ ok: true });
    expect(await changeMessages()).toEqual([]);
  });

  it("saves nothing and says how many it sends, while nobody has decided", async () => {
    await bookMartina();
    await bookPatient("Pedro", "+5491155550001", at("12:30"));

    expect(await createTimeOff()).toEqual({
      ok: false,
      reason: "affectsAppointments",
      affected: 2,
    });
    expect(expectOk(await world.organization.listTimeOff(adminCaller)).timeOff).toEqual([]);
    expect(await listedCount()).toBe(0);
  });

  it("saves and tells them once told how many and asked to", async () => {
    const martina = await bookMartina();

    expectOk(await createTimeOff({ tellPatients: true, affected: 1 }));

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentToReschedule", appointmentId: martina }),
    ]);
  });

  it("saves without telling them, and still lists their appointments, when asked not to", async () => {
    await bookMartina();

    expectOk(await createTimeOff({ tellPatients: false, affected: 1 }));

    expect(await changeMessages()).toEqual([]);
    expect(await listedCount()).toBe(1);
  });

  it("asks again with the new count when it changed since they were told", async () => {
    await bookMartina();
    await bookPatient("Pedro", "+5491155550001", at("12:30"));

    expect(await createTimeOff({ tellPatients: true, affected: 1 })).toEqual({
      ok: false,
      reason: "affectsAppointments",
      affected: 2,
    });
    expect(await changeMessages()).toEqual([]);
    expect(await listedCount()).toBe(0);
  });

  it("asks with the count when told what to do but not how many", async () => {
    await bookMartina();

    expect(await createTimeOff({ tellPatients: true })).toEqual({
      ok: false,
      reason: "affectsAppointments",
      affected: 1,
    });
    expect(await changeMessages()).toEqual([]);
    expect(await listedCount()).toBe(0);
  });

  it("counts only the appointments an edit newly sends to the list", async () => {
    await bookMartina();
    const timeOff = expectOk(await createTimeOff({ tellPatients: true, affected: 1 })).timeOff;
    await bookPatient("Pedro", "+5491155550001", at("13:30"));

    const widened = (notice: { tellPatients?: boolean; affected?: number } = {}) =>
      world.organization.updateTimeOff(adminCaller, {
        timeOffId: timeOff.id,
        entry: { kind: "hours", start: "2099-01-05T08:00", end: "2099-01-05T11:00" },
        ...notice,
      });

    expect(await widened()).toEqual({ ok: false, reason: "affectsAppointments", affected: 1 });
    expectOk(await widened({ tellPatients: false, affected: 1 }));
    expect(await listedCount()).toBe(2);
  });

  it("asks the same of a closure, and of its edit", async () => {
    await bookMartina();
    const createClosure = (notice: { tellPatients?: boolean; affected?: number } = {}) =>
      world.organization.createClosure(adminCaller, {
        officeId: null,
        entry: { kind: "days", firstDate: "2099-01-04", lastDate: "2099-01-04" },
        ...notice,
      });
    const closure = expectOk(await createClosure()).closure;

    const moved = (notice: { tellPatients?: boolean; affected?: number } = {}) =>
      world.organization.updateClosure(adminCaller, {
        closureId: closure.id,
        officeId: null,
        entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
        ...notice,
      });

    expect(await moved()).toEqual({ ok: false, reason: "affectsAppointments", affected: 1 });
    expectOk(await moved({ tellPatients: true, affected: 1 }));
    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentToReschedule", state: "queued" }),
    ]);
  });
});

describe('telling patients their appointment went to the "to reschedule" list', () => {
  it("queues `turno_a_reprogramar` for each appointment time off sends to the list", async () => {
    const martina = await bookMartina();
    const pedro = await bookPatient("Pedro", "+5491155550001", at("12:30"));

    await addTimeOff();

    expect(await changeMessages()).toEqual([
      {
        kind: "appointmentToReschedule",
        appointmentId: martina,
        state: "queued",
        dropReason: null,
      },
      { kind: "appointmentToReschedule", appointmentId: pedro, state: "queued", dropReason: null },
    ]);
  });

  it("queues none again for an appointment already on the list when the time off is edited", async () => {
    await bookMartina();
    const timeOff = await addTimeOff();

    expectOk(
      await answeringNotice(true, (notice) =>
        world.organization.updateTimeOff(adminCaller, {
          timeOffId: timeOff.id,
          entry: { kind: "hours", start: "2099-01-05T08:00", end: "2099-01-05T10:00" },
          ...notice,
        }),
      ),
    );

    expect(await changeMessages()).toHaveLength(1);
  });

  it("drops a queued `turno_movido` when time off nobody is told about covers the new time", async () => {
    const appointmentId = await bookPatient("Martina", "+5491155550000", at("13:00"));
    expectOk(await reschedule(appointmentId, at("12:00")));

    await addTimeOff(false);

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentMoved", state: "dropped" }),
    ]);
  });

  it("drops a queued `turno_a_reprogramar` once the appointment is off the list", async () => {
    await bookMartina();
    const timeOff = await addTimeOff();

    expectOk(await world.organization.deleteTimeOff(adminCaller, { timeOffId: timeOff.id }));

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentToReschedule", state: "dropped" }),
    ]);
  });

  it("queues it for an appointment a closure sends to the list", async () => {
    const appointmentId = await bookMartina();

    expectOk(
      await answeringNotice(true, (notice) =>
        world.organization.createClosure(adminCaller, {
          officeId: null,
          entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
          ...notice,
        }),
      ),
    );

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentToReschedule", appointmentId }),
    ]);
  });

  it("queues it for an appointment a schedule change sends to the list", async () => {
    const appointmentId = await bookPatient("Martina", "+5491155550000", at("12:00", "2099-01-12"));

    expectOk(
      await world.organization.endSchedule(adminCaller, {
        scheduleId: juanScheduleId,
        lastDate: "2099-01-05",
      }),
    );

    expect(await changeMessages()).toEqual([
      expect.objectContaining({ kind: "appointmentToReschedule", appointmentId }),
    ]);
  });
});

/** Submits template `templateId` with its draft, signed, and has Meta approve it at once. */
function approveTemplate(templateId: string, metaId: string) {
  return submitTemplate(world.organization, templateId, { status: "APPROVED", metaId });
}

/** The date and time Meta was sent to fill in the one message the object sent. */
function sentDateAndTime() {
  const [request] = fakeMeta.requests.filter((one) => one.url.endsWith("/messages"));
  const { template } = request!.body as {
    template: { components: { parameters: { parameter_name: string; text: string }[] }[] };
  };
  const filled = new Map(
    template.components[0]!.parameters.map((one) => [one.parameter_name, one.text]),
  );
  return { fecha: filled.get("fecha"), hora: filled.get("hora") };
}

/** The template of each message the object sent Meta, in order. */
function sentTemplates() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map((request) => (request.body as { template: { name: string } }).template.name);
}

describe("sending the message for the latest change", () => {
  beforeEach(async () => {
    await approveTemplate("turno_movido", "900000000000021");
    await approveTemplate("turno_cancelado", "900000000000022");
    await approveTemplate("turno_a_reprogramar", "900000000000023");
    fakeMeta.answerWith(200, {
      messaging_product: "whatsapp",
      contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
      messages: [{ id: "wamid.change" }],
    });
  });

  it("sends `turno_movido` with the appointment's new time", async () => {
    const appointmentId = await bookMartina();
    expectOk(await reschedule(appointmentId));

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["turno_movido_v1"]);
    expect(sentDateAndTime()).toEqual({ fecha: "lunes 12 de enero", hora: "09:00" });
  });

  it("sends nothing once a cancellation by the business is undone before the alarm fires", async () => {
    const appointmentId = await bookMartina();
    expectOk(await cancel(appointmentId, "business"));
    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([]);
  });

  it("sends nothing for an appointment the deleted time off no longer sends to the list", async () => {
    await bookMartina();
    const timeOff = await addTimeOff();
    expectOk(await world.organization.deleteTimeOff(adminCaller, { timeOffId: timeOff.id }));

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([]);
  });

  it("sends `turno_a_reprogramar` while the appointment is still on the list", async () => {
    await bookMartina();
    await addTimeOff();

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["turno_a_reprogramar_v1"]);
  });

  it("sends only `turno_cancelado` for an appointment moved and then cancelled before the alarm fires", async () => {
    const appointmentId = await bookMartina();
    expectOk(await reschedule(appointmentId));
    expectOk(await cancel(appointmentId, "business"));

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["turno_cancelado_v1"]);
  });
});

describe('reminders for an appointment on the "to reschedule" list', () => {
  const nineOnMonday = at("12:00");

  let reminderId: string;

  beforeEach(async () => {
    reminderId = await templateNamed(world.organization, "Recordatorio con confirmación");
    await submitTemplate(world.organization, reminderId, {
      status: "APPROVED",
      metaId: "900000000000024",
      timing: { when: "before", hours: 48 },
    });
    await world.pickTemplates(medicalServiceId, [reminderId]);
    fakeMeta.answerWith(200, {
      messaging_product: "whatsapp",
      contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
      messages: [{ id: "wamid.reminder" }],
    });
  });

  /** Runs the alarm at the reminder's time, 48 hours before the appointment. */
  async function atReminderTime() {
    vi.setSystemTime(+nineOnMonday - 48 * 60 * 60_000);
    await runDurableObjectAlarm(world.organization);
  }

  it("sends none while time off keeps the appointment on the list, told or not", async () => {
    await bookMartina();
    await addTimeOff(false);

    await atReminderTime();

    expect(sentTemplates()).toEqual([]);
  });

  it("sends none after a cancellation is undone while the appointment is still on the list", async () => {
    const appointmentId = await bookMartina();
    await addTimeOff(false);
    expectOk(await cancel(appointmentId, "patient"));
    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    await atReminderTime();

    expect(sentTemplates()).toEqual([]);
  });

  it("sends it once deleting the time off takes the appointment off the list", async () => {
    await bookMartina();
    const timeOff = await addTimeOff(false);
    expectOk(await world.organization.deleteTimeOff(adminCaller, { timeOffId: timeOff.id }));

    await atReminderTime();

    expect(sentTemplates()).toEqual([metaTemplateName(reminderId, 1)]);
  });
});
