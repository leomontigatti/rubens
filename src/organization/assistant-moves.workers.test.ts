import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addOffice,
  addRoom,
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
} from "#/organization/organization.test-support.ts";
import { outboxMessage } from "#/organization/whatsapp-schema.ts";

// A patient moving their appointment in the conversation
// (docs/domain/assistant.md § Cancelling and moving), through the object's
// assistant, proposal and availability: the free times offered, the move on
// the patient's yes, and the cutoff and once-per-appointment rules that hand
// it off instead. Meta is faked at its HTTP boundary and the model scripted
// at its port.

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

const notClinical = { needsPractitioner: false, emergency: false };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
let martinaId: string;
let appointmentId: string;

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

function turn() {
  return afterTheWait(world.organization);
}

/** A free time as find_free_times offers it, on a Monday of January 2099. */
function slot(day: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const start = new Date(Date.UTC(2099, 0, day, hours! + 3, minutes));
  return {
    slotId: start.toISOString(),
    date: `lunes ${day} de enero`,
    time,
    office: "Sede Centro",
  };
}

/** Runs a turn that asks for the free times, and returns what find_free_times gave. */
async function freeTimesAsked(text = "lo puedo cambiar?") {
  await writes(text);
  let found: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    found = one.call("find_free_times", { appointmentId });
    return "Tengo estos horarios.";
  });
  await turn();
  return found as { ok: boolean; reason?: string; slots?: ReturnType<typeof slot>[] };
}

/** Proposes the move to `slotId` in one turn and accepts it on the patient's yes in the next. */
async function patientMoves(slotId: string) {
  await writes("el lunes 12 a las 10");
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    one.call("propose_change", { appointmentId, kind: "move", slotId });
    return "Te paso el turno al lunes 12 de enero a las 10:00. Confirmás?";
  });
  await turn();
  await writes("sí");
  let accepted: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    accepted = one.call("accept_proposal");
    return "Listo, quedó movido.";
  });
  await turn();
  return accepted as { ok: boolean; reason?: string };
}

/** What the handoff notifications an admin got say of why, without the conversation read back. */
async function handoffNotices() {
  const listed = expectOk(await world.organization.listNotifications(adminCaller));
  return listed.notifications.filter((one) => one.kind === "handoff").map((one) => one.handoff);
}

/** The open handoffs an admin sees in the inbox. */
async function openHandoffs() {
  return expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
}

function queuedMoveMessages() {
  return inStorage(world.organization, (database) =>
    database
      .select({ id: outboxMessage.id })
      .from(outboxMessage)
      .where(
        and(
          eq(outboxMessage.appointmentId, appointmentId),
          eq(outboxMessage.kind, "appointmentMoved"),
          eq(outboxMessage.state, "queued"),
        ),
      )
      .all(),
  );
}

beforeEach(async () => {
  // Thursday 1 January 2099: the next 3 weeks hold the Mondays 5, 12 and 19,
  // and Juan works Mondays from 09:00 to 11:00 in Buenos Aires.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  martinaId = (await world.addPatient("Martina", martinaPhone)).id;
  appointmentId = (
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martinaId,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the free times offered", () => {
  it("are the practitioner's free starts over the next 3 weeks, without the appointment's own time, a taken one or an overbooking", async () => {
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: at("12:30", "2099-01-12"),
      durationMinutes: 30,
    });
    // Another practitioner's schedule: none of its times is offered.
    await world.addSchedule({
      practitionerId: world.lucia.practitionerId,
      roomId: world.otherRoom.id,
    });

    const found = await freeTimesAsked();

    expect(found).toEqual({
      ok: true,
      practitioner: "Juan Gómez",
      medicalService: "Consulta",
      slots: [
        slot(5, "09:30"),
        slot(5, "10:00"),
        slot(5, "10:30"),
        slot(12, "09:00"),
        slot(12, "10:00"),
        slot(12, "10:30"),
        slot(19, "09:00"),
        slot(19, "09:30"),
        slot(19, "10:00"),
        slot(19, "10:30"),
      ],
      more: false,
    });
  });

  it("start from the date asked for, to show later ones", async () => {
    await writes("tenés algo el 19?");
    let found: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      found = one.call("find_free_times", { appointmentId, from: "2099-01-19" });
      return "El lunes 19 tengo estos horarios.";
    });
    await turn();

    expect(found).toMatchObject({
      slots: [slot(19, "09:00"), slot(19, "09:30"), slot(19, "10:00"), slot(19, "10:30")],
    });
  });

  it("start from the date and time asked for, so a day's later times are reached too", async () => {
    await writes("tenés algo el 19 después de las 10?");
    let found: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      found = one.call("find_free_times", { appointmentId, from: "2099-01-19T10:00" });
      return "El lunes 19 tengo estos horarios.";
    });
    await turn();

    expect(found).toMatchObject({ slots: [slot(19, "10:00"), slot(19, "10:30")] });
  });

  it("refuses a time find_free_times did not offer", async () => {
    await writes("pasalo al domingo a las 3");
    let proposed: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      proposed = one.call("propose_change", {
        appointmentId,
        kind: "move",
        slotId: new Date("2099-01-04T18:00:00Z").toISOString(),
      });
      return "Ese horario no está disponible.";
    });
    await turn();

    expect(proposed).toEqual({ ok: false, reason: "notFree" });
  });
});

describe("moving on the patient's yes", () => {
  it("moves the appointment to the time picked, frees the old one, and tells nobody it was moved by the practice", async () => {
    const accepted = await patientMoves(slot(12, "10:00").slotId);

    expect(accepted).toEqual({
      ok: true,
      applied: {
        kind: "move",
        medicalService: "Consulta",
        practitioner: "Juan Gómez",
        date: "lunes 5 de enero",
        time: "09:00",
        office: "Sede Centro",
        newDate: "lunes 12 de enero",
        newTime: "10:00",
        newOffice: "Sede Centro",
      },
    });
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("13:00", "2099-01-12"));
    expect((await auditEntriesFor(world.organization, appointmentId)).at(-1)).toMatchObject({
      userId: "assistant",
    });
    expect(await queuedMoveMessages()).toEqual([]);
    expect(fakeMeta.textsSent().at(-1)).toEqual({
      to: "5491155550000",
      text: "Listo, quedó movido.",
    });
    // The old time is free: another patient books it without an overbooking.
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    });
  });

  it("drops the message about a staff move that has not gone yet", async () => {
    // No template is approved, so the staff move's message waits in the outbox.
    expectOk(
      await world.organization.rescheduleAppointment(world.receptionist, {
        appointmentId,
        start: at("12:30"),
        durationMinutes: 30,
      }),
    );
    expect(await queuedMoveMessages()).toHaveLength(1);

    expect(await patientMoves(slot(12, "10:00").slotId)).toMatchObject({ ok: true });

    expect(await queuedMoveMessages()).toEqual([]);
  });

  it("fails a yes once the time no longer reads as the patient was told, though it is still free", async () => {
    // Juan also works Tuesdays at a second office, from 08:00 to 12:00.
    const norte = await addOffice(world.organization, "Sede Norte");
    const norteRoom = await addRoom(world.organization, norte.id, "Consultorio 1");
    await world.addSchedule({
      practitionerId: world.juan.practitionerId,
      roomId: norteRoom.id,
      weekdays: [2],
      startTime: "08:00",
      endTime: "12:00",
    });
    await writes("puede ser el martes 13 a las 10?");
    const tuesdayTen = new Date("2099-01-13T13:00:00Z").toISOString();
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("propose_change", { appointmentId, kind: "move", slotId: tuesdayTen });
      return "Te lo paso al martes 13 de enero a las 10:00 en Sede Norte. Confirmás?";
    });
    await turn();
    // The second office's zone is corrected: the same instant is now 08:00 there.
    expectOk(
      await world.organization.updateOffice(adminCaller, {
        officeId: norte.id,
        name: "Sede Norte",
        address: "Av. Colón 100",
        timeZone: "America/Bogota",
      }),
    );

    await writes("sí");
    let accepted: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      accepted = one.call("accept_proposal");
      return "No lo pude mover.";
    });
    await turn();

    expect(accepted).toEqual({ ok: false, reason: "timeTaken" });
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("12:00"));
  });

  it("fails a time booked by someone else since the offer, and offers the others", async () => {
    await writes("lo puedo pasar al 12 a las 10?");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("propose_change", { appointmentId, kind: "move", slotId: slot(12, "10:00").slotId });
      return "Te lo paso al lunes 12 de enero a las 10:00. Confirmás?";
    });
    await turn();
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: at("13:00", "2099-01-12"),
      durationMinutes: 30,
    });

    await writes("sí");
    let accepted: unknown;
    let others: { slots?: { slotId: string }[] } = {};
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      accepted = one.call("accept_proposal");
      others = one.call("find_free_times", { appointmentId }) as typeof others;
      return "Ese horario se ocupó. Tengo estos otros.";
    });
    await turn();

    expect(accepted).toEqual({ ok: false, reason: "timeTaken" });
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("12:00"));
    expect(others.slots).not.toContainEqual(slot(12, "10:00"));
    expect(others.slots).toContainEqual(slot(12, "10:30"));
  });
});

describe("the move's rules", () => {
  it("refuses the patient's second move of the appointment and hands it off", async () => {
    expect(await patientMoves(slot(12, "10:00").slotId)).toMatchObject({ ok: true });
    const sentBefore = fakeMeta.textsSent().length;

    const found = await freeTimesAsked("perdón, lo puedo cambiar otra vez?");

    expect(found).toEqual({ ok: false, reason: "moveUsed" });
    expect(await openHandoffs()).toMatchObject([{ reason: "ruleRefused", forPractitioner: false }]);
    // The refusal is a person's to explain: the patient hears nothing of it.
    expect(fakeMeta.textsSent()).toHaveLength(sentBefore);
    expect(await handoffNotices()).toMatchObject([
      {
        reason: "ruleRefused",
        patient: expect.stringContaining("Martina"),
        detail: {
          refused: { why: "moveUsed", date: "lunes 12 de enero", time: "10:00" },
          applied: [],
        },
      },
    ]);
  });

  it("still allows the patient's one move after staff moved the appointment", async () => {
    expectOk(
      await world.organization.rescheduleAppointment(world.receptionist, {
        appointmentId,
        start: at("12:30"),
        durationMinutes: 30,
      }),
    );

    expect(await patientMoves(slot(12, "10:00").slotId)).toMatchObject({ ok: true });
  });

  it("still allows the patient's one move after time off put it on the to-reschedule list", async () => {
    expectOk(
      await world.organization.createTimeOff(adminCaller, {
        practitionerId: world.juan.practitionerId,
        entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
        tellPatients: true,
      }),
    );

    expect(await patientMoves(slot(12, "10:00").slotId)).toMatchObject({ ok: true });
  });

  it("refuses a move past the medical service's cutoff and hands it off", async () => {
    // 23 hours before the appointment, inside the default 24-hour cutoff.
    vi.setSystemTime(new Date(+at("12:00") - 23 * 60 * 60_000));

    const found = await freeTimesAsked("mañana no llego, lo podemos pasar?");

    expect(found).toEqual({ ok: false, reason: "pastCutoff" });
    expect(await openHandoffs()).toMatchObject([{ reason: "ruleRefused", forPractitioner: false }]);
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("12:00"));
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await handoffNotices()).toMatchObject([
      { detail: { refused: { why: "pastCutoff", cutoffHours: 24, date: "lunes 5 de enero" } } },
    ]);
  });

  it("moves the appointment the patient said yes to, says only that, and hands off the one a rule refused in the same turn", async () => {
    const later = await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martinaId,
      medicalServiceId,
      start: at("12:00", "2099-01-19"),
      durationMinutes: 30,
    });
    // The first appointment is inside its cutoff; the later one is not.
    vi.setSystemTime(new Date(+at("12:00") - 23 * 60 * 60_000));
    await writes("el del 19 pasalo al 12 a las 10");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("propose_change", {
        appointmentId: later.id,
        kind: "move",
        slotId: slot(12, "10:00").slotId,
      });
      return "Te paso el turno del lunes 19 al lunes 12 de enero a las 10:00. Confirmás?";
    });
    await turn();

    await writes("sí. y el de mañana también se puede?");
    let accepted: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("find_free_times", { appointmentId });
      accepted = one.call("accept_proposal");
      return "Listo, el del 19 quedó el lunes 12 a las 10:00.";
    });
    await turn();

    expect(accepted).toMatchObject({ ok: true });
    expect(+(await world.appointmentOf(later.id)).start).toBe(+at("13:00", "2099-01-12"));
    expect(await openHandoffs()).toMatchObject([{ reason: "ruleRefused" }]);
    // The reply covers what the turn did, after the clinical check, and nothing of the refusal.
    expect(scriptedModel.checks.at(-1)?.reply).toBe(
      "Listo, el del 19 quedó el lunes 12 a las 10:00.",
    );
    expect(fakeMeta.textsSent().at(-1)).toEqual({
      to: "5491155550000",
      text: "Listo, el del 19 quedó el lunes 12 a las 10:00.",
    });
    expect(await handoffNotices()).toMatchObject([
      {
        detail: {
          refused: { why: "pastCutoff", date: "lunes 5 de enero" },
          applied: [
            {
              kind: "move",
              date: "lunes 19 de enero",
              newDate: "lunes 12 de enero",
              newTime: "10:00",
            },
          ],
        },
      },
    ]);
  });

  it("refuses the yes to a move once the cutoff passed since the proposal", async () => {
    vi.setSystemTime(new Date(+at("12:00") - 24 * 60 * 60_000 - 10 * 60_000));
    await writes("lo paso al 12 a las 10");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("propose_change", { appointmentId, kind: "move", slotId: slot(12, "10:00").slotId });
      return "Te lo paso al lunes 12 de enero a las 10:00. Confirmás?";
    });
    await turn();

    // 20 minutes on: inside the proposal's hour, past the cutoff.
    vi.setSystemTime(new Date(+at("12:00") - 24 * 60 * 60_000 + 10 * 60_000));
    await writes("sí");
    let accepted: unknown;
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      accepted = one.call("accept_proposal");
      return "No lo pude mover.";
    });
    await turn();

    expect(accepted).toEqual({ ok: false, reason: "pastCutoff" });
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("12:00"));
    expect(await openHandoffs()).toMatchObject([{ reason: "ruleRefused" }]);
  });
});
