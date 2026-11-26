import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { confirmPayload } from "#/lib/button-payloads.ts";

import {
  adminCaller,
  afterTheWait as afterWait,
  answeringNotice,
  at,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  patientTaps,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A patient's tap on a template's quick-reply button (ADR-0014): `Sí, voy`
// confirms the appointment its payload names with no model call, and any tap
// code cannot act on goes to the model as the patient's words.

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
const reminder =
  "Hola Martina! Te escribimos de Consultorios Prueba para recordarte tu turno con Juan Gómez del lunes 5 de enero a las 09:00. Por favor, confirmanos si venís o si necesitás cambiarlo.";
const start = at("12:00");

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
let martinaId: string;
let appointmentId: string;

function afterTheWait() {
  return afterWait(world.organization);
}

/** The reminder the practice sent Martina's number, as the outbox stores it; returns its Meta id. */
function reminderSent() {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  return inStorage(world.organization, (database) => {
    const { id } = database
      .insert(conversation)
      .values({ phone: martinaPhone })
      .returning({ id: conversation.id })
      .get();
    database
      .insert(whatsappMessage)
      .values({
        conversationId: id,
        whatsappId,
        direction: "outgoing",
        type: "template",
        text: reminder,
        payload: "{}",
        sentAt: Date.now(),
        status: "delivered",
      })
      .run();
    return whatsappId;
  });
}

/** Martina taps `Sí, voy` on `repliesTo`, sent for `appointment` at `startsAt`. */
function tapsYes(repliesTo: string, appointment = appointmentId, startsAt = start) {
  return patientTaps(world.organization, {
    from: martinaPhone,
    label: "Sí, voy",
    payload: confirmPayload(appointment, new Date(startsAt).getTime()),
    repliesTo,
  });
}

function textsSent() {
  return fakeMeta.textsSent().map((one) => one.text);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  martinaId = (await world.addPatient("Martina", martinaPhone)).id;
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  appointmentId = (
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martinaId,
      medicalServiceId,
      start,
      durationMinutes: 30,
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a tap on `Sí, voy`", () => {
  it("confirms the appointment its payload names and answers with the fixed reply, with no model call", async () => {
    await tapsYes(await reminderSent());

    await afterTheWait();

    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
    expect(textsSent()).toEqual(["Genial, te esperamos!"]);
    expect(scriptedModel.turns).toHaveLength(0);
  });

  it("answers again, changing nothing, for an appointment already confirmed", async () => {
    const sent = await reminderSent();
    await tapsYes(sent);
    await afterTheWait();
    const audited = await auditEntriesFor(world.organization, appointmentId);

    await tapsYes(sent);
    await afterTheWait();

    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
    expect(await auditEntriesFor(world.organization, appointmentId)).toEqual(audited);
    expect(textsSent()).toEqual(["Genial, te esperamos!", "Genial, te esperamos!"]);
    expect(scriptedModel.turns).toHaveLength(0);
  });

  it("goes to the model when the appointment went on the to-reschedule list since, confirming nothing", async () => {
    const sent = await reminderSent();
    expectOk(
      await answeringNotice(false, (notice) =>
        world.organization.createClosure(adminCaller, {
          entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
          ...notice,
        }),
      ),
    );

    await tapsYes(sent);
    await afterTheWait();

    expect(scriptedModel.turns).toHaveLength(1);
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("goes to the model with the message it answers when the appointment moved since", async () => {
    const sent = await reminderSent();
    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: at("13:00"),
        durationMinutes: 30,
      }),
    );

    await tapsYes(sent);
    await afterTheWait();

    expect(scriptedModel.turns.at(-1)!.messages.at(-1)!.content).toBe(
      `[new messages]\n[tocó el botón «Sí, voy» del mensaje: «${reminder}»]`,
    );
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("goes to the model, with the text written during the wait, in one turn", async () => {
    await tapsYes(await reminderSent());
    await patientWrites(world.organization, "no, esperá, mejor el jueves", martinaPhone);

    await afterTheWait();

    expect(scriptedModel.turns).toHaveLength(1);
    expect(scriptedModel.turns[0]!.messages.at(-1)!.content).toBe(
      `[new messages]\n[tocó el botón «Sí, voy» del mensaje: «${reminder}»]\nno, esperá, mejor el jueves`,
    );
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("confirms, on a number siblings share, the sibling's appointment its payload names", async () => {
    const [brotherId] = await world.addPatientsSharing(martinaPhone, 1);
    const brothers = (
      await world.book({
        practitionerId: world.juan.practitionerId,
        patientId: brotherId!,
        medicalServiceId,
        start: at("13:00"),
        durationMinutes: 30,
      })
    ).id;

    await tapsYes(await reminderSent(), brothers, at("13:00"));
    await afterTheWait();

    expect((await world.appointmentOf(brothers)).status).toBe("confirmed");
    expect((await world.appointmentOf(appointmentId)).status).toBe("booked");
  });

  it("confirms and answers while a member holds the conversation", async () => {
    const sent = await reminderSent();
    const [held] = expectOk(
      await world.organization.listConversations(adminCaller, {}),
    ).conversations;
    expectOk(
      await world.organization.takeOverConversation(world.receptionist, {
        conversationId: held!.id,
      }),
    );

    await tapsYes(sent);
    await afterTheWait();

    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
    expect(textsSent()).toEqual(["Genial, te esperamos!"]);
  });
});

describe("a tap on `Necesito cambiarlo`", () => {
  it("goes to the model as the patient's words, with the message it answers", async () => {
    await patientTaps(world.organization, {
      from: martinaPhone,
      label: "Necesito cambiarlo",
      repliesTo: await reminderSent(),
    });

    await afterTheWait();

    expect(scriptedModel.turns.map((turn) => turn.messages.at(-1)!.content)).toEqual([
      `[new messages]\n[tocó el botón «Necesito cambiarlo» del mensaje: «${reminder}»]`,
    ]);
  });
});
