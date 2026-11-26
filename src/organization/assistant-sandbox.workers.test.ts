import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { sandboxModelCallsPerHour } from "#/lib/assistant-sandbox.ts";
import type { SandboxState } from "#/lib/assistant-sandbox.ts";

import {
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  recordedModelUsage,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import type { ScriptedTurn } from "#/organization/organization.test-support.ts";
import { appointment, patient } from "#/organization/schema.ts";
import { outboxMessage, proposal } from "#/organization/whatsapp-schema.ts";

// The assistant's sandbox (docs/domain/assistant.md § Trying it): an admin
// plays the patient against the real assistant, its real tools and the real
// agenda, from a scenario, and nothing it does is kept: no appointment
// changes, nothing is queued, nothing reaches Meta, and its conversation and
// proposals stay apart from the real ones. Its model runs count as sandbox
// use. The model is scripted at its port; Meta is faked at its HTTP boundary,
// answering every call with an error, and no test expects a call to it.

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
let appointmentId: string;

async function startSandbox() {
  return expectOk(await world.organization.startSandbox(adminCaller, { appointmentId })).sandbox;
}

/** The admin writes `text` as the patient in the sandbox conversation `state`. */
async function playPatient(state: SandboxState, text: string) {
  return expectOk(await world.organization.sandboxTurn(adminCaller, { state, text }));
}

const fromJson = (text: string) => z.json().parse(JSON.parse(text));

/** The free times find_free_times returns, by the id a proposal takes. */
const freeTimes = z.object({ slots: z.array(z.object({ slotId: z.string() })) });

/** The free times find_free_times returns, by what the patient reads. */
const moveTimes = z.object({
  slots: z.array(z.looseObject({ slotId: z.string(), time: z.string() })),
});

/** The free times find_booking_times returns, by the id a booking proposal takes. */
const bookingTimes = z.object({
  slots: z.array(z.looseObject({ slotId: z.string(), date: z.string(), time: z.string() })),
});

/** Finds Monday 5 January at 10:00 for a new appointment, as a sandbox turn's model does. */
function mondayAtTen(turn: ScriptedTurn) {
  const found = bookingTimes.parse(
    turn.call("find_booking_times", { medicalService: "Consulta", from: "2099-01-05" }),
  );
  return found.slots.find((one) => one.date === "lunes 5 de enero" && one.time === "10:00")?.slotId;
}

/**
 * Two sandbox turns from `state`: the first, on `text`, proposes Monday 5
 * January at 10:00 with `args`; the second accepts it on the patient's yes.
 */
async function booksMondayAtTen(state: SandboxState, text: string, args: Record<string, unknown>) {
  scriptedModel.script((turn) => {
    turn.call("judge_messages", { ...notClinical, booking: true });
    turn.call("propose_booking", { ...args, slotId: mondayAtTen(turn) });
    return "Te reservo la consulta con Juan Gómez el lunes 5 de enero a las 10:00. Te parece bien?";
  });
  const proposed = await playPatient(state, text);
  scriptedModel.script((turn) => {
    turn.call("judge_messages", { ...notClinical, booking: true });
    turn.call("accept_proposal");
    return "Listo, te reservé la consulta.";
  });
  return { proposed, booked: await playPatient(proposed.sandbox, "sí") };
}

/** What list_patients returns: each patient's id and upcoming appointments. */
const listing = z.object({
  patients: z.array(
    z.looseObject({
      patientId: z.string(),
      firstName: z.string(),
      upcomingAppointments: z.array(z.looseObject({ appointmentId: z.string(), time: z.string() })),
    }),
  ),
});

/** The appointment at 10:00 that list_patients lists. */
function bookedAtTen(listed: unknown) {
  return listing
    .parse(listed)
    .patients.flatMap((one) => one.upcomingAppointments)
    .find((one) => one.time === "10:00")?.appointmentId;
}

/** The next sandbox turn's list_patients, from `state`. */
async function listedAfter(state: SandboxState) {
  let listed: unknown;
  scriptedModel.script((turn) => {
    turn.call("judge_messages", notClinical);
    listed = turn.call("list_patients");
    return "Tenés estos turnos.";
  });
  return { played: await playPatient(state, "¿qué turnos tengo?"), listed };
}

/** Every appointment, patient and proposal the object stores: the real agenda and who is on it. */
function stored() {
  return inStorage(world.organization, (database) => ({
    appointments: database
      .select({ id: appointment.id, startsAt: appointment.startsAt, status: appointment.status })
      .from(appointment)
      .all(),
    patients: database.select({ firstName: patient.firstName }).from(patient).all(),
    proposals: database.select({ id: proposal.id }).from(proposal).all(),
  }));
}

/** A turn's tool calls as the sandbox shows them: each one's name, what it was asked and what it returned. */
function toolCalls(played: Awaited<ReturnType<typeof playPatient>>) {
  return played.turn.toolCalls.map((call) => ({
    name: call.name,
    args: fromJson(call.args),
    result: fromJson(call.result),
  }));
}

/** Every message the object queued, in any state. */
function outbox() {
  return inStorage(world.organization, (database) =>
    database.select({ id: outboxMessage.id, kind: outboxMessage.kind }).from(outboxMessage).all(),
  );
}

beforeEach(async () => {
  // Thursday 1 January 2099; Martina's appointment is on Monday the 5th.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  fakeMeta.answerWith(500, { error: { message: "The sandbox must not reach Meta" } });
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  const martina = await world.addPatient("Martina", martinaPhone);
  appointmentId = (
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martina.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a sandbox conversation", () => {
  it("cancels nothing: the appointment stays booked, nothing is queued, Meta hears nothing, and the cancel and its result are shown", async () => {
    const queuedBefore = await outbox();
    const started = await startSandbox();
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("propose_change", { appointmentId, kind: "cancel" });
      turn.call("accept_proposal");
      return "Listo, cancelé tu turno del lunes.";
    });

    const played = await playPatient(started, "cancelalo por favor");

    expect(toolCalls(played).map((call) => [call.name, call.result])).toEqual([
      ["judge_messages", { ok: true }],
      ["propose_change", expect.objectContaining({ ok: true })],
      ["accept_proposal", expect.objectContaining({ ok: true })],
    ]);
    expect(played.turn.replies).toEqual(["Listo, cancelé tu turno del lunes."]);
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
    expect(await outbox()).toEqual(queuedBefore);
    expect(fakeMeta.requests).toEqual([]);
  });

  it("starts from the scenario's reminder, filled from the appointment", async () => {
    const started = await startSandbox();

    expect(started.messages).toEqual([
      {
        direction: "outgoing",
        text: expect.stringContaining(
          "Hola Martina! Te escribimos de Consultorios Prueba para recordarte tu turno con Juan Gómez del lunes 5 de enero a las 09:00.",
        ),
        sentAt: Date.now(),
        judgement: null,
      },
    ]);
  });

  it("keeps its own changes from turn to turn: a cancel accepted on the yes leaves no upcoming appointment to the next turn", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("propose_change", { appointmentId, kind: "cancel" });
      return "¿Te cancelo el turno del lunes 5 de enero a las 09:00?";
    });
    const proposed = await playPatient(await startSandbox(), "no voy a poder ir, cancelalo");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("accept_proposal");
      return "Listo, quedó cancelado.";
    });
    const accepted = await playPatient(proposed.sandbox, "sí");
    let listed: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      listed = turn.call("list_patients");
      return "No tenés turnos próximos.";
    });

    await playPatient(accepted.sandbox, "¿me quedó algún turno?");

    expect(toolCalls(accepted)[1]).toMatchObject({
      name: "accept_proposal",
      result: { ok: true, applied: { kind: "cancel" } },
    });
    expect(accepted.sandbox.proposals).toEqual([
      expect.objectContaining({ kind: "cancel", acceptedAt: expect.any(Number) }),
    ]);
    expect(listed).toEqual({
      patients: [{ patientId: expect.any(String), firstName: "Martina", upcomingAppointments: [] }],
    });
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("shows a move it proposed, from the free times it found", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const found = freeTimes.parse(turn.call("find_free_times", { appointmentId }));
      turn.call("propose_change", { appointmentId, kind: "move", slotId: found.slots[0]!.slotId });
      return "Te lo paso al lunes 5 de enero a las 09:30. Te lo cambio?";
    });

    const played = await playPatient(await startSandbox(), "lo puedo pasar?");

    expect(played.sandbox.proposals).toEqual([
      expect.objectContaining({
        kind: "move",
        acceptedAt: null,
        statement: expect.objectContaining({ newDate: "lunes 5 de enero", newTime: "09:30" }),
      }),
    ]);
    expect(played.turn.replies).toEqual([
      "Te lo paso al lunes 5 de enero a las 09:30. Te lo cambio?",
    ]);
  });

  it("keeps a move it accepted in its next turns, at the new time", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const found = freeTimes.parse(turn.call("find_free_times", { appointmentId }));
      turn.call("propose_change", { appointmentId, kind: "move", slotId: found.slots[0]!.slotId });
      turn.call("accept_proposal");
      return "Listo, lo pasé.";
    });
    const moved = await playPatient(await startSandbox(), "pasalo al primer horario");
    let listed: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      listed = turn.call("list_patients");
      return "Tu turno es el lunes a las 09:30.";
    });

    const after = await playPatient(moved.sandbox, "¿a qué hora quedó?");

    expect(after.sandbox.proposals[0]?.acceptedAt).toEqual(expect.any(Number));
    expect(listed).toMatchObject({
      patients: [{ upcomingAppointments: [{ appointmentId, time: "09:30" }] }],
    });
    expect(+(await world.appointmentOf(appointmentId)).start).toBe(+at("12:00"));
  });

  it("books for the number's patient and keeps the booking in its next turns, leaving no appointment, proposal or message behind", async () => {
    const queuedBefore = await outbox();
    const storedBefore = await stored();

    const { proposed, booked } = await booksMondayAtTen(
      await startSandbox(),
      "quiero otro turno el lunes a las 10",
      {},
    );
    const { played, listed } = await listedAfter(booked.sandbox);

    expect(toolCalls(proposed).map((call) => [call.name, call.result])).toEqual([
      ["judge_messages", { ok: true }],
      ["find_booking_times", expect.objectContaining({ ok: true })],
      ["propose_booking", expect.objectContaining({ ok: true })],
    ]);
    expect(toolCalls(booked).map((call) => [call.name, call.result])).toEqual([
      ["judge_messages", { ok: true }],
      ["accept_proposal", expect.objectContaining({ ok: true })],
    ]);
    expect(played.sandbox.proposals).toEqual([
      expect.objectContaining({
        kind: "book",
        acceptedAt: expect.any(Number),
        statement: expect.objectContaining({ date: "lunes 5 de enero", time: "10:00" }),
      }),
    ]);
    expect(listed).toMatchObject({
      patients: [
        {
          firstName: "Martina",
          upcomingAppointments: [{ appointmentId }, { time: "10:00" }],
        },
      ],
    });
    expect(await stored()).toEqual(storedBefore);
    expect(await outbox()).toEqual(queuedBefore);
    expect(fakeMeta.requests).toEqual([]);
  });

  it("refuses to accept a booking in the turn that proposed it", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { ...notClinical, booking: true });
      turn.call("propose_booking", { slotId: mondayAtTen(turn) });
      turn.call("accept_proposal");
      return "Listo, te reservé la consulta.";
    });

    const played = await playPatient(await startSandbox(), "quiero otro turno el lunes a las 10");

    expect(toolCalls(played).at(-1)).toEqual({
      name: "accept_proposal",
      args: {},
      result: { ok: false, reason: "notShownYet" },
    });
    expect(played.sandbox.proposals).toEqual([
      expect.objectContaining({ kind: "book", acceptedAt: null }),
    ]);
  });

  it("cancels an appointment it booked, in a later turn", async () => {
    const storedBefore = await stored();
    const { booked } = await booksMondayAtTen(
      await startSandbox(),
      "quiero otro turno el lunes a las 10",
      {},
    );
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const newAppointment = bookedAtTen(turn.call("list_patients"));
      turn.call("propose_change", { appointmentId: newAppointment, kind: "cancel" });
      turn.call("accept_proposal");
      return "Listo, cancelé el turno de las 10:00.";
    });

    const cancelled = await playPatient(booked.sandbox, "mejor cancelá el de las 10");
    const { listed } = await listedAfter(cancelled.sandbox);

    expect(toolCalls(cancelled)).toMatchObject([
      { name: "judge_messages", result: { ok: true } },
      { name: "list_patients" },
      { name: "propose_change", result: { ok: true } },
      { name: "accept_proposal", result: { ok: true } },
    ]);
    expect(listed).toMatchObject({ patients: [{ upcomingAppointments: [{ appointmentId }] }] });
    expect(await stored()).toEqual(storedBefore);
  });

  it("moves an appointment it booked, in a later turn", async () => {
    const storedBefore = await stored();
    const { booked } = await booksMondayAtTen(
      await startSandbox(),
      "quiero otro turno el lunes a las 10",
      {},
    );
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const newAppointment = bookedAtTen(turn.call("list_patients"));
      const found = moveTimes.parse(
        turn.call("find_free_times", { appointmentId: newAppointment }),
      );
      const slotId = found.slots.find((one) => one.time === "10:30")?.slotId;
      turn.call("propose_change", { appointmentId: newAppointment, kind: "move", slotId });
      turn.call("accept_proposal");
      return "Listo, te lo pasé a las 10:30.";
    });

    const moved = await playPatient(booked.sandbox, "pasá el de las 10 a las 10:30");
    const { listed } = await listedAfter(moved.sandbox);

    expect(toolCalls(moved)).toMatchObject([
      { name: "judge_messages", result: { ok: true } },
      { name: "list_patients" },
      { name: "find_free_times", result: { ok: true } },
      { name: "propose_change", result: { ok: true } },
      { name: "accept_proposal", result: { ok: true } },
    ]);
    expect(listed).toMatchObject({
      patients: [{ upcomingAppointments: [{ appointmentId }, { time: "10:30" }] }],
    });
    expect(await stored()).toEqual(storedBefore);
  });

  it("registers a person the practice does not know only in the sandbox, and keeps their booking in its next turns", async () => {
    const storedBefore = await stored();

    const { booked } = await booksMondayAtTen(
      await startSandbox(),
      "quiero un turno para mi hijo Tomás Ruiz",
      { newPatientName: { firstName: "Tomás", lastName: "Ruiz" } },
    );
    const { played, listed } = await listedAfter(booked.sandbox);

    expect(toolCalls(booked).at(-1)).toMatchObject({
      name: "accept_proposal",
      result: { ok: true, applied: { kind: "book", newPatient: "Tomás Ruiz" } },
    });
    expect(played.sandbox.proposals).toEqual([
      expect.objectContaining({ kind: "book", acceptedAt: expect.any(Number) }),
    ]);
    expect(listed).toMatchObject({
      patients: expect.arrayContaining([
        expect.objectContaining({
          firstName: "Tomás",
          upcomingAppointments: [expect.objectContaining({ time: "10:00" })],
        }),
      ]),
    });
    expect(await stored()).toEqual(storedBefore);
  });

  it("books again for a person it registered, in a later turn", async () => {
    const storedBefore = await stored();
    const { booked } = await booksMondayAtTen(
      await startSandbox(),
      "quiero un turno para mi hijo Tomás Ruiz",
      { newPatientName: { firstName: "Tomás", lastName: "Ruiz" } },
    );
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { ...notClinical, booking: true });
      const tomas = listing
        .parse(turn.call("list_patients"))
        .patients.find((one) => one.firstName === "Tomás");
      const found = bookingTimes.parse(
        turn.call("find_booking_times", { medicalService: "Consulta", from: "2099-01-05" }),
      );
      const slotId = found.slots.find((one) => one.time === "10:30")?.slotId;
      turn.call("propose_booking", { patientId: tomas?.patientId, slotId });
      return "Te reservo otra consulta para Tomás el lunes 5 de enero a las 10:30. Te parece bien?";
    });
    const proposed = await playPatient(booked.sandbox, "y otro para Tomás a las 10:30");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { ...notClinical, booking: true });
      turn.call("accept_proposal");
      return "Listo, te reservé la consulta.";
    });

    const again = await playPatient(proposed.sandbox, "sí");
    const { listed } = await listedAfter(again.sandbox);

    expect(toolCalls(proposed).at(-1)).toMatchObject({
      name: "propose_booking",
      result: { ok: true },
    });
    expect(toolCalls(again).at(-1)).toMatchObject({
      name: "accept_proposal",
      result: { ok: true },
    });
    expect(listed).toMatchObject({
      patients: expect.arrayContaining([
        expect.objectContaining({
          firstName: "Tomás",
          upcomingAppointments: [
            expect.objectContaining({ time: "10:00" }),
            expect.objectContaining({ time: "10:30" }),
          ],
        }),
      ]),
    });
    expect(await stored()).toEqual(storedBefore);
  });

  it("no longer holds a move it accepted once the new time is booked for real, and says so", async () => {
    let slotId = "";
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const found = freeTimes.parse(turn.call("find_free_times", { appointmentId }));
      slotId = found.slots[0]!.slotId;
      turn.call("propose_change", { appointmentId, kind: "move", slotId });
      turn.call("accept_proposal");
      return "Listo, lo pasé.";
    });
    const moved = await playPatient(await startSandbox(), "pasalo al primer horario");
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId,
      start: new Date(slotId),
      durationMinutes: 30,
    });
    let listed: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      listed = turn.call("list_patients");
      return "Tu turno es el lunes a las 09:00.";
    });

    const after = await playPatient(moved.sandbox, "¿a qué hora quedó?");

    expect(moved.sandbox.proposals[0]?.acceptedAt).toEqual(expect.any(Number));
    expect(after.sandbox.proposals[0]?.acceptedAt).toBeNull();
    expect(listed).toMatchObject({
      patients: [{ upcomingAppointments: [{ appointmentId, time: "09:00" }] }],
    });
  });

  it("starts no scenario from an appointment that is no longer upcoming, and goes on with none", async () => {
    const started = await startSandbox();
    expectOk(
      await world.organization.cancelAppointment(world.receptionist, {
        appointmentId,
        cancelledBy: "patient",
      }),
    );

    expect(await world.organization.startSandbox(adminCaller, { appointmentId })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(
      await world.organization.sandboxTurn(adminCaller, { state: started, text: "hola" }),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("refuses a turn once the conversation has no room for it, before the model runs", async () => {
    const started = await startSandbox();
    const message = {
      direction: "incoming" as const,
      text: "hola",
      judgement: "notForPractitioner" as const,
    };
    const full = {
      ...started,
      messages: [
        ...started.messages,
        ...Array.from({ length: 116 }, (_, index) => ({
          ...message,
          sentAt: Date.now() + index + 1,
        })),
      ],
    };

    expect(
      await world.organization.sandboxTurn(adminCaller, { state: full, text: "¿sigo?" }),
    ).toEqual({ ok: false, reason: "conversationFull" });
    expect(scriptedModel.turns).toEqual([]);
  });

  it("plays a turn after more messages than one statement binds", async () => {
    const started = await startSandbox();
    const long = {
      ...started,
      messages: [
        ...started.messages,
        ...Array.from({ length: 40 }, (_, index) => ({
          direction: index % 2 === 0 ? ("incoming" as const) : ("outgoing" as const),
          text: index % 2 === 0 ? "hola" : "Hola, ¿en qué te ayudo?",
          judgement: index % 2 === 0 ? ("notForPractitioner" as const) : null,
          sentAt: Date.now() + index + 1,
        })),
      ],
    };
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "Sigo acá.";
    });

    const played = await playPatient(long, "¿seguís?");

    expect(played.sandbox.messages.at(-1)).toMatchObject({
      direction: "outgoing",
      text: "Sigo acá.",
    });
  });

  it("stays apart from the number's real conversation: neither sees the other's proposal, and the inbox shows only the real one", async () => {
    // Meta answers the real conversation's reply; the sandbox still reaches it never.
    fakeMeta.reset();
    await patientWrites(world.organization, "quiero cancelar", martinaPhone);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("propose_change", { appointmentId, kind: "cancel" });
      return "Te cancelo el turno del lunes?";
    });
    await afterTheWait(world.organization);
    const metaRequests = fakeMeta.requests.length;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("accept_proposal");
      return "Listo.";
    });

    const played = await playPatient(await startSandbox(), "sí");

    expect(toolCalls(played)[1]?.result).toEqual({ ok: false, reason: "noProposal" });
    const listed = expectOk(await world.organization.listConversations(adminCaller, {}));
    expect(listed.conversations).toHaveLength(1);
    const read = expectOk(
      await world.organization.readConversation(adminCaller, {
        conversationId: listed.conversations[0]!.id,
      }),
    );
    expect(read.messages.map((message) => message.text)).toEqual([
      "quiero cancelar",
      "Te cancelo el turno del lunes?",
    ]);
    const proposals = await inStorage(world.organization, (database) =>
      database.select({ acceptedAt: proposal.acceptedAt }).from(proposal).all(),
    );
    expect(proposals).toEqual([{ acceptedAt: null }]);
    expect(fakeMeta.requests).toHaveLength(metaRequests);
  });

  it("shows a reply the clinical check would hold as held, and the handoff's reply in its place", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "Ese dolor es normal después de la consulta.";
    });
    scriptedModel.scriptCheck({ clinical: true, otherPatient: false });

    const played = await playPatient(await startSandbox(), "me duele un poco");

    expect(played.turn.held).toEqual({
      text: "Ese dolor es normal después de la consulta.",
      because: "clinical",
    });
    expect(played.turn.replies).toEqual(["Le paso tu consulta al profesional."]);
    expect(played.sandbox.handoffs).toEqual([
      expect.objectContaining({
        reason: "heldReply",
        forPractitioner: true,
        heldBecause: "clinical",
      }),
    ]);
    expect(expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs).toEqual(
      [],
    );
  });

  it("shows a reply that names a tool as held for reception, and nothing told in its place", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "Busqué con find_free_times y no hay lugar.";
    });

    const played = await playPatient(await startSandbox(), "hay lugar el martes?");

    expect(played.turn.held).toEqual({
      text: "Busqué con find_free_times y no hay lugar.",
      because: "internals",
    });
    expect(played.turn.replies).toEqual([]);
    expect(played.sandbox.handoffs).toEqual([
      expect.objectContaining({
        reason: "leakedReply",
        forPractitioner: false,
        heldBecause: "internals",
      }),
    ]);
  });

  it("shows a repeat about its open handoff as the change the turn made, then that a person has the rest", async () => {
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { healthQuestion: true, emergency: false });
      return "";
    });
    const handedOff = await playPatient(await startSandbox(), "me duele la muela hace dos días");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { healthQuestion: true, emergency: false });
      turn.call("propose_change", { appointmentId, kind: "confirm" });
      turn.call("accept_proposal");
      return "Listo, confirmado el lunes.";
    });

    const played = await playPatient(handedOff.sandbox, "el lunes voy. y con la muela qué hago?");

    expect(played.turn.outcome).toBe("alreadyHandedOff");
    expect(played.turn.replies).toEqual([
      "Listo, confirmado el lunes.",
      "Ya se lo pasé, te va a responder por acá.",
    ]);
    expect(played.sandbox.handoffs).toHaveLength(1);
  });

  it("counts the window from the patient's last message", async () => {
    const played = await playPatient(await startSandbox(), "hola");

    expect(played.windowClosesAt).toBe(played.sandbox.messages[1]!.sentAt + 24 * 60 * 60_000);
  });
});

describe("sandbox use", () => {
  it("is recorded as sandbox use, apart from the patients' conversations", async () => {
    await patientWrites(world.organization, "hola", martinaPhone);
    scriptedModel.script((turn) => {
      turn.uses({ inputTokens: 1_000, outputTokens: 10 });
      turn.call("judge_messages", notClinical);
      return "Hola Martina.";
    });
    await afterTheWait(world.organization);
    scriptedModel.checkUses({ inputTokens: 300, outputTokens: 5 });
    scriptedModel.script((turn) => {
      turn.uses({ inputTokens: 1_200, outputTokens: 40 });
      turn.call("judge_messages", notClinical);
      return "Hola, ¿en qué te ayudo?";
    });

    await playPatient(await startSandbox(), "hola");

    const runs = await recordedModelUsage(world.organization);
    expect(
      runs.map(({ purpose, sandbox, inputTokens }) => ({ purpose, sandbox, inputTokens })),
    ).toEqual([
      { purpose: "turn", sandbox: false, inputTokens: 1_000 },
      { purpose: "turn", sandbox: true, inputTokens: 1_200 },
      { purpose: "clinicalCheck", sandbox: true, inputTokens: 300 },
    ]);
  });

  it("is refused past the hour's limit, and allowed again an hour later", async () => {
    const started = await startSandbox();
    scriptedModel.script((turn) => {
      for (let call = 0; call < sandboxModelCallsPerHour; call += 1) {
        turn.uses({ inputTokens: 1, outputTokens: 1 });
      }
      turn.call("judge_messages", notClinical);
      return "Hola.";
    });
    const played = await playPatient(started, "hola");

    const refused = await world.organization.sandboxTurn(adminCaller, {
      state: played.sandbox,
      text: "¿sigo?",
    });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    const later = await world.organization.sandboxTurn(adminCaller, {
      state: played.sandbox,
      text: "¿sigo?",
    });

    expect(refused).toEqual({ ok: false, reason: "rateLimited" });
    expect(later.ok).toBe(true);
  });
  it("counts the turns still running against the limit, so overlapping turns cannot pass it together", async () => {
    const started = await startSandbox();
    scriptedModel.script((turn) => {
      for (let call = 0; call < sandboxModelCallsPerHour - 5; call += 1) {
        turn.uses({ inputTokens: 1, outputTokens: 1 });
      }
      turn.call("judge_messages", notClinical);
      return "Hola.";
    });
    const played = await playPatient(started, "hola");
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    scriptedModel.script(async (turn) => {
      await released;
      turn.call("judge_messages", notClinical);
      return "Hola de nuevo.";
    });
    const running = world.organization.sandboxTurn(adminCaller, {
      state: played.sandbox,
      text: "¿estás?",
    });
    await scriptedModel.turnsStarted(world.organization, 2);

    const meanwhile = await world.organization.sandboxTurn(adminCaller, {
      state: played.sandbox,
      text: "¿y ahora?",
    });
    release();
    await running;
    const after = await world.organization.sandboxTurn(adminCaller, {
      state: played.sandbox,
      text: "¿y ahora?",
    });

    expect(meanwhile).toEqual({ ok: false, reason: "rateLimited" });
    expect(after.ok).toBe(true);
  });
});

describe("the sandbox", () => {
  it("refuses anyone but an active admin, before the model runs", async () => {
    const started = await startSandbox();
    const refused = [
      { caller: world.receptionist, reason: "forbidden" },
      { caller: { userId: "user-stranger" }, reason: "unauthenticated" },
      {
        caller: await addRefusedAdmin(world.organization, "deactivated"),
        reason: "unauthenticated",
      },
      {
        caller: await addRefusedAdmin(world.organization, "mustChangePassword"),
        reason: "mustChangePassword",
      },
    ];

    for (const { caller, reason } of refused) {
      const refusal = { ok: false, reason };
      expect(await world.organization.sandboxScenarios(caller)).toEqual(refusal);
      expect(await world.organization.startSandbox(caller, { appointmentId })).toEqual(refusal);
      expect(
        await world.organization.sandboxTurn(caller, { state: started, text: "hola" }),
      ).toEqual(refusal);
    }
    expect(scriptedModel.turns).toEqual([]);
  });

  it("starts from the upcoming appointments of patients WhatsApp reaches", async () => {
    const scenarios = expectOk(await world.organization.sandboxScenarios(adminCaller)).scenarios;

    expect(scenarios).toEqual([
      expect.objectContaining({
        appointmentId,
        patient: "Martina Paz",
        practitioner: "Juan Gómez",
      }),
    ]);
  });

  it("refuses a turn while the Worker has no model key", async () => {
    const started = await startSandbox();
    scriptedModel.hasApiKey = false;

    expect(
      await world.organization.sandboxTurn(adminCaller, { state: started, text: "hola" }),
    ).toEqual({ ok: false, reason: "missingApiKey" });
  });
});
