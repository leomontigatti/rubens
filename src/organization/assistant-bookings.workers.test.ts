import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { eq } from "drizzle-orm";

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
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import { outboxMessage, proposal } from "#/organization/whatsapp-schema.ts";

// A patient the number stands for alone booking a new appointment in the
// conversation (docs/domain/assistant.md § For patients), through the
// object's assistant, proposal and booking: the proposal of a time
// find_booking_times offered, the booking on the patient's yes, and what it
// leaves behind. Meta is faked at its HTTP boundary and the model scripted
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

const notClinical = { healthQuestion: false, emergency: false };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
let martinaId: string;

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

function turn() {
  return afterTheWait(world.organization);
}

/** What find_booking_times returns: the free times offered. */
const bookingTimes = z.looseObject({
  slots: z.array(z.looseObject({ slotId: z.string(), date: z.string(), time: z.string() })),
});

/** Runs a turn that asks for times from Monday 5 January, and returns the slotId offered for `time` on `date`. */
async function offeredSlot(date: string, time: string) {
  await writes("quiero un turno para una consulta");
  let found: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    found = one.call("find_booking_times", { medicalService: "Consulta", from: "2099-01-05" });
    return "Tengo estos horarios.";
  });
  await turn();
  const offered = bookingTimes
    .parse(found)
    .slots.find((one) => one.date === date && one.time === time);
  if (!offered) {
    throw new Error(`${date} ${time} was not offered`);
  }
  return offered.slotId;
}

/** Runs a turn that proposes booking `slotId` for `patientId`, and returns what propose_booking gave. */
async function proposes(slotId: string, patientId = martinaId) {
  await writes("el lunes 5 a las 10");
  let proposed: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    proposed = one.call("propose_booking", { patientId, slotId });
    return "Te reservo la consulta con Juan Gómez el lunes 5 de enero a las 10:00. Te parece bien?";
  });
  await turn();
  return proposed;
}

/** Runs a turn on the patient's yes, and returns what accept_proposal gave. */
async function accepts() {
  await writes("sí");
  let accepted: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    accepted = one.call("accept_proposal");
    return "Listo, te reservé el turno.";
  });
  await turn();
  return accepted;
}

async function martinasUpcoming() {
  return expectOk(
    await world.organization.getPatientAppointments(adminCaller, { patientId: martinaId }),
  ).upcoming;
}

function storedProposals() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        kind: proposal.kind,
        appointmentId: proposal.appointmentId,
        patientId: proposal.patientId,
        medicalServiceId: proposal.medicalServiceId,
        practitionerId: proposal.practitionerId,
        roomId: proposal.roomId,
        startsAt: proposal.startsAt,
        endsAt: proposal.endsAt,
        acceptedAt: proposal.acceptedAt,
      })
      .from(proposal)
      .all(),
  );
}

beforeEach(async () => {
  // Thursday 1 January 2099. Juan works Mondays from 09:00 to 11:00 in
  // Buenos Aires, in the first room, and offers the medical service.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  martinaId = (await world.addPatient("Martina", martinaPhone)).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("proposing a booking", () => {
  it("stores every fact of a time find_booking_times offered, and states it without the room", async () => {
    const slotId = await offeredSlot("lunes 5 de enero", "10:00");

    const proposed = await proposes(slotId);

    expect(proposed).toEqual({
      ok: true,
      proposal: {
        kind: "book",
        medicalService: "Consulta",
        practitioner: "Juan Gómez",
        date: "lunes 5 de enero",
        time: "10:00",
      },
      alreadyBooked: [],
    });
    expect(await storedProposals()).toEqual([
      {
        kind: "book",
        appointmentId: null,
        patientId: martinaId,
        medicalServiceId,
        practitionerId: world.juan.practitionerId,
        roomId: world.room.id,
        startsAt: +at("13:00"),
        endsAt: +at("13:30"),
        acceptedAt: null,
      },
    ]);
  });

  it("refuses a time find_booking_times did not offer, and stores nothing", async () => {
    // Sunday 4 January at 15:00 in Buenos Aires: Juan does not work then.
    const proposed = await proposes(medicalServiceId + "@2099-01-04T18:00:00.000Z");

    expect(proposed).toEqual({ ok: false, reason: "notFree" });
    expect(await storedProposals()).toEqual([]);
  });

  it("refuses a patient the number does not stand for", async () => {
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    const slotId = await offeredSlot("lunes 5 de enero", "10:00");

    expect(await proposes(slotId, tomas.id)).toEqual({ ok: false, reason: "notFound" });
    expect(await storedProposals()).toEqual([]);
  });

  it("tells of the patient's other appointments that day, overlapping or not, before the yes", async () => {
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martinaId,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    });
    const kinesiology = expectOk(
      await world.organization.createMedicalService(adminCaller, {
        practitionerId: world.lucia.practitionerId,
        name: "Kinesiología",
        durationMinutes: 60,
      }),
    ).medicalService;
    await world.overbook({
      practitionerId: world.lucia.practitionerId,
      patientId: martinaId,
      medicalServiceId: kinesiology.id,
      start: at("12:45"),
      durationMinutes: 60,
      roomId: world.otherRoom.id,
      confirmWarnings: true,
    });
    const slotId = await offeredSlot("lunes 5 de enero", "10:00");

    expect(await proposes(slotId)).toMatchObject({
      ok: true,
      alreadyBooked: [
        { date: "lunes 5 de enero", time: "09:00", practitioner: "Juan Gómez", overlaps: false },
        { date: "lunes 5 de enero", time: "09:45", practitioner: "Lucía Díaz", overlaps: true },
      ],
    });
  });

  it("hands nothing off for a patient with no upcoming appointment who asks for one", async () => {
    await offeredSlot("lunes 5 de enero", "10:00");

    expect(expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs).toEqual(
      [],
    );
    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: "Tengo estos horarios." }]);
  });
});

describe("booking on the patient's yes", () => {
  it("books the time proposed as the assistant, with the reminders its medical service picks and no template sent at booking", async () => {
    const confirmation = await templateNamed(world.organization, "Confirmación del turno");
    const dayBefore = await templateNamed(world.organization, "Recordatorio con confirmación");
    await submitTemplate(world.organization, confirmation, { status: "APPROVED", metaId: "m-1" });
    await submitTemplate(world.organization, dayBefore, { status: "APPROVED", metaId: "m-2" });
    await world.pickTemplates(medicalServiceId, [confirmation, dayBefore]);
    await proposes(await offeredSlot("lunes 5 de enero", "10:00"));

    const accepted = await accepts();

    expect(accepted).toEqual({
      ok: true,
      applied: {
        kind: "book",
        medicalService: "Consulta",
        practitioner: "Juan Gómez",
        date: "lunes 5 de enero",
        time: "10:00",
      },
    });
    const upcoming = await martinasUpcoming();
    expect(upcoming).toMatchObject([
      {
        start: at("13:00"),
        end: at("13:30"),
        status: "booked",
        practitionerName: "Juan Gómez",
        medicalServiceName: "Consulta",
        roomName: "Consultorio 1",
        overbooking: false,
      },
    ]);
    const appointmentId = upcoming[0]!.id;
    expect(await auditEntriesFor(world.organization, appointmentId)).toMatchObject([
      { action: "create", userId: "assistant", patientId: martinaId },
    ]);
    expect(await storedProposals()).toMatchObject([{ acceptedAt: expect.any(Number) }]);
    const queued = await inStorage(world.organization, (database) =>
      database
        .select({ templateId: outboxMessage.templateId, dueAt: outboxMessage.dueAt })
        .from(outboxMessage)
        .where(eq(outboxMessage.appointmentId, appointmentId))
        .all(),
    );
    expect(queued).toEqual([{ templateId: dayBefore, dueAt: +at("13:00") - 24 * 60 * 60_000 }]);
    expect(fakeMeta.textsSent().at(-1)).toEqual({
      to: "5491155550000",
      text: "Listo, te reservé el turno.",
    });
  });

  it("tells the practitioner whose appointment it is, which medical service and when", async () => {
    await proposes(await offeredSlot("lunes 5 de enero", "10:00"));

    await accepts();

    const listed = expectOk(await world.organization.listNotifications(world.juan.caller));
    expect(
      listed.notifications
        .filter((one) => one.kind === "appointmentBooked")
        .map((one) => one.appointment),
    ).toMatchObject([
      {
        patient: "Martina Paz",
        practitioner: "Juan Gómez",
        medicalService: "Consulta",
        startsAt: +at("13:00"),
      },
    ]);
    const others = expectOk(await world.organization.listNotifications(world.lucia.caller));
    expect(others.notifications.filter((one) => one.kind === "appointmentBooked")).toEqual([]);
  });

  it("fails a time booked by someone else since the proposal, and books nothing", async () => {
    await proposes(await offeredSlot("lunes 5 de enero", "10:00"));
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: at("13:00"),
      durationMinutes: 30,
    });

    expect(await accepts()).toEqual({ ok: false, reason: "timeTaken" });
    expect(await martinasUpcoming()).toEqual([]);
    expect(await storedProposals()).toMatchObject([{ acceptedAt: null }]);
  });

  it("books only the latest proposal, and none once it expired", async () => {
    await proposes(await offeredSlot("lunes 5 de enero", "10:00"));
    await proposes(await offeredSlot("lunes 5 de enero", "10:30"));
    vi.setSystemTime(Date.now() + 61 * 60_000);

    expect(await accepts()).toEqual({ ok: false, reason: "expired" });

    await proposes(await offeredSlot("lunes 5 de enero", "10:00"));
    await proposes(await offeredSlot("lunes 5 de enero", "10:30"));
    expect(await accepts()).toMatchObject({ ok: true, applied: { time: "10:30" } });
    expect((await martinasUpcoming()).map((one) => one.start)).toEqual([at("13:30")]);
  });
});
