import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sandboxModelCallsPerHour } from "#/lib/assistant-sandbox.ts";
import type { SandboxState } from "#/lib/assistant-sandbox.ts";
import { assistantModelId } from "#/lib/assistant.ts";

import {
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
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

const notClinical = { clinical: false, emergency: false };

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

/** A turn's tool calls as the sandbox shows them: each one's name, what it was asked and what it returned. */
function toolCalls(played: Awaited<ReturnType<typeof playPatient>>) {
  return played.turn.toolCalls.map((call) => ({
    name: call.name,
    args: JSON.parse(call.args) as unknown,
    result: JSON.parse(call.result) as unknown,
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
          "Hola Martina, te escribimos de Consultorios Prueba para recordarte tu turno con Juan Gómez del lunes 5 de enero a las 09:00 en Sede Centro.",
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
      const found = turn.call("find_free_times", { appointmentId }) as {
        slots: { slotId: string }[];
      };
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
      const found = turn.call("find_free_times", { appointmentId }) as {
        slots: { slotId: string }[];
      };
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

  it("no longer holds a move it accepted once the new time is booked for real, and says so", async () => {
    let slotId = "";
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      const found = turn.call("find_free_times", { appointmentId }) as {
        slots: { slotId: string }[];
      };
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
      judgement: "notClinical" as const,
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
    expect(
      read.messages.map((message) => ("text" in message ? message.text : message.withheld)),
    ).toEqual(["quiero cancelar", "Te cancelo el turno del lunes?"]);
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

    expect(played.turn.held).toBe("Ese dolor es normal después de la consulta.");
    expect(played.turn.replies).toEqual([
      "Gracias por escribirnos. Le pasamos tu mensaje a una persona del equipo, que te va a responder por acá.",
    ]);
    expect(played.sandbox.handoffs).toEqual([
      expect.objectContaining({ reason: "heldReply", clinical: true }),
    ]);
    expect(expectOk(await world.organization.listOpenHandoffs(adminCaller, {})).handoffs).toEqual(
      [],
    );
  });

  it("counts the window from the patient's last message", async () => {
    const played = await playPatient(await startSandbox(), "hola");

    expect(played.windowClosesAt).toBe(played.sandbox.messages[1]!.sentAt + 24 * 60 * 60_000);
  });
});

describe("sandbox use", () => {
  it("is recorded on a line of its own, apart from the patients' conversations", async () => {
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

    const usage = expectOk(await world.organization.whatsappSettings(adminCaller)).usage;
    expect(usage.models).toEqual([
      { model: assistantModelId, sandbox: false, inputTokens: 1_000, outputTokens: 10 },
      { model: assistantModelId, sandbox: true, inputTokens: 1_500, outputTokens: 45 },
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
    while (scriptedModel.turns.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

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
