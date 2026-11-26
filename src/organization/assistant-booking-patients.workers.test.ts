import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  adminCaller,
  afterTheWait,
  at,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// Who a booking in the conversation is for (docs/domain/assistant.md § For
// patients): one of the several patients a number stands for, chosen first,
// or a person the practice does not know, registered as an incomplete patient
// in the transaction that books. Meta is faked at its HTTP boundary and the
// model scripted at its port.

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
const unknownPhone = "+5493515550123";

const askingToBook = { healthQuestion: false, emergency: false, booking: true };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

const bookingTimes = z.looseObject({
  slots: z.array(z.looseObject({ slotId: z.string(), date: z.string(), time: z.string() })),
});

/** Runs a turn from `phone` that is offered Monday 5 January at 10:00, then one that proposes it with `args`; returns what propose_booking gave. */
async function proposes(phone: string, args: Record<string, unknown>) {
  await patientWrites(world.organization, "quiero un turno para una consulta", phone);
  let found: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    found = one.call("find_booking_times", { medicalService: "Consulta", from: "2099-01-05" });
    return "Tengo estos horarios.";
  });
  await afterTheWait(world.organization);
  const offered = bookingTimes
    .parse(found)
    .slots.find((one) => one.date === "lunes 5 de enero" && one.time === "10:00");
  if (!offered) {
    throw new Error("Monday 5 January at 10:00 was not offered");
  }
  await patientWrites(world.organization, "el lunes 5 a las 10", phone);
  let proposed: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    proposed = one.call("propose_booking", { slotId: offered.slotId, ...args });
    return "Te reservo la consulta con Juan Gómez el lunes 5 de enero a las 10:00. Te parece bien?";
  });
  await afterTheWait(world.organization);
  return proposed;
}

/** Runs a turn from `phone` on the patient's yes, and returns what accept_proposal gave. */
async function accepts(phone: string) {
  await patientWrites(world.organization, "sí", phone);
  let accepted: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    accepted = one.call("accept_proposal");
    return "Listo, te reservé el turno.";
  });
  await afterTheWait(world.organization);
  return accepted;
}

async function upcomingOf(patientId: string) {
  return expectOk(await world.organization.getPatientAppointments(adminCaller, { patientId }))
    .upcoming;
}

async function patientsNamed(lastName: string) {
  const listed = expectOk(
    await world.organization.searchPatients(adminCaller, {
      query: lastName,
      includeInactive: false,
    }),
  );
  return listed.patients;
}

async function conversationPatients(phone: string) {
  const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
  const found = listed.conversations.find((one) => one.phone === phone);
  return (found?.patients ?? []).map((one) => one.name).sort();
}

async function openHandoffs() {
  return expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs;
}

beforeEach(async () => {
  // Thursday 1 January 2099. Juan works Mondays from 09:00 to 11:00 in
  // Buenos Aires and offers the medical service.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a number that stands for several patients", () => {
  it("refuses a booking proposal until one of them is chosen, then books for that one", async () => {
    const [martinaId, tomasId] = await world.addPatientsSharing(martinaPhone, 2);

    expect(await proposes(martinaPhone, {})).toEqual({ ok: false, reason: "patientNotChosen" });

    expect(await proposes(martinaPhone, { patientId: tomasId })).toMatchObject({ ok: true });
    expect(await accepts(martinaPhone)).toMatchObject({ ok: true });
    expect(await upcomingOf(tomasId!)).toMatchObject([{ start: at("13:00") }]);
    expect(await upcomingOf(martinaId!)).toEqual([]);
  });

  it("books for the one patient a number stands for alone, unnamed", async () => {
    const martina = await world.addPatient("Martina", martinaPhone);

    expect(await proposes(martinaPhone, {})).toMatchObject({ ok: true });
    expect(await accepts(martinaPhone)).toMatchObject({ ok: true });
    expect(await upcomingOf(martina.id)).toMatchObject([{ start: at("13:00") }]);
  });
});

describe("a number that stands for nobody", () => {
  it("books once it gives a name, registering an incomplete patient with consent given to the assistant", async () => {
    expect(await proposes(unknownPhone, {})).toEqual({ ok: false, reason: "nameNeeded" });
    expect(
      await proposes(unknownPhone, { newPatientName: { firstName: "Ana", lastName: "Ríos" } }),
    ).toMatchObject({ ok: true, proposal: { kind: "book", newPatient: "Ana Ríos" } });
    expect(await patientsNamed("Ríos")).toEqual([]);

    expect(await accepts(unknownPhone)).toMatchObject({ ok: true });

    const [ana, ...others] = await patientsNamed("Ríos");
    expect(others).toEqual([]);
    expect(ana).toMatchObject({
      firstName: "Ana",
      lastName: "Ríos",
      phone: unknownPhone,
      incompletePatient: true,
      whatsappConsent: true,
      whatsappConsentBy: "assistant",
    });
    expect(await upcomingOf(ana!.id)).toMatchObject([{ start: at("13:00"), status: "booked" }]);
    expect(await auditEntriesFor(world.organization, ana!.id)).toMatchObject([
      { action: "create", userId: "assistant", patientId: ana!.id },
    ]);
    expect(await conversationPatients(unknownPhone)).toEqual(["Ana Ríos"]);
    expect(await openHandoffs()).toEqual([]);
  });

  it("registers nobody when the time was taken since the proposal", async () => {
    await proposes(unknownPhone, { newPatientName: { firstName: "Ana", lastName: "Ríos" } });
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: at("13:00"),
      durationMinutes: 30,
    });

    expect(await accepts(unknownPhone)).toEqual({ ok: false, reason: "timeTaken" });
    expect(await patientsNamed("Ríos")).toEqual([]);
    expect(await conversationPatients(unknownPhone)).toEqual([]);
  });
});

describe("a known number booking for a person the practice does not know", () => {
  it("registers an incomplete patient whose messages go to that number", async () => {
    const martina = await world.addPatient("Martina", martinaPhone);

    await proposes(martinaPhone, { newPatientName: { firstName: "Tomás", lastName: "Ríos" } });
    expect(await accepts(martinaPhone)).toMatchObject({ ok: true });

    const [tomas] = await patientsNamed("Ríos");
    expect(tomas).toMatchObject({
      phone: martinaPhone,
      incompletePatient: true,
      whatsappConsent: true,
      whatsappConsentBy: "assistant",
    });
    expect(await upcomingOf(tomas!.id)).toMatchObject([{ start: at("13:00") }]);
    expect(await upcomingOf(martina.id)).toEqual([]);
    expect(await conversationPatients(martinaPhone)).toEqual(["Martina Paz", "Tomás Ríos"]);
  });
});
