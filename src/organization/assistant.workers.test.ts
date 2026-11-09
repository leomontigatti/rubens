import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The object reaches Meta only through its Graph API client, whose HTTP calls
// go to the fake Meta, and the model only through its port, scripted per test.
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

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

/** A text from `from`, stored as Meta's webhook hands it over, sent now by Meta's clock unless `sentAt` says. */
async function patientWrites(text: string, from = martinaPhone, sentAt = Date.now()) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [{ whatsappId, from, sentAt, type: "text", text, payload: "{}" }],
      statuses: [],
      templateStatuses: [],
    }),
  );
  return whatsappId;
}

/** Books `firstName`, reached at `phone`, at 09:00 in Buenos Aires on the first Monday. */
async function bookPatient(firstName: string, phone: string, start = at("12:00")) {
  const patient = await world.addPatient(firstName, phone);
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start,
    durationMinutes: 30,
  });
  return { patientId: patient.id, appointmentId: booked.id };
}

/** Moves the object's clock on by `ms`. */
function wait(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

/** The texts the object sent Meta, to whom. */
function textsToMeta() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map((request) => request.body as { to: string; type: string; text?: { body: string } })
    .filter((body) => body.type === "text")
    .map((body) => ({ to: body.to, text: body.text?.body }));
}

/** Every stored message, oldest first. */
function storedMessages() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        whatsappId: whatsappMessage.whatsappId,
        direction: whatsappMessage.direction,
        text: whatsappMessage.text,
        judgement: whatsappMessage.judgement,
        emergency: whatsappMessage.emergency,
        rulesVersion: whatsappMessage.rulesVersion,
      })
      .from(whatsappMessage)
      .orderBy(sql`${whatsappMessage}.rowid`)
      .all(),
  );
}

function scheduledAlarm() {
  return runInDurableObject(world.organization, (_instance, state) => state.storage.getAlarm());
}

/** Runs the object's alarm once the assistant's wait is over. */
async function afterTheWait() {
  wait(8_000);
  await runDurableObjectAlarm(world.organization);
}

/** The judgement every turn of these tests makes unless it says otherwise. */
const notClinical = { clinical: false, emergency: false };

beforeEach(async () => {
  // The object's clock, a month before the appointments: the alarm it sets
  // stays in the runtime scheduler's future, so it fires only when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the assistant's pace", () => {
  it("answers three messages 2 seconds apart in one turn, after the last one's wait", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    wait(2_000);
    await patientWrites("una pregunta");
    wait(2_000);
    await patientWrites("cuándo es mi turno?");
    const lastAt = Date.now();

    expect(await scheduledAlarm()).toBe(lastAt + 8_000);
    wait(7_000);
    await runDurableObjectAlarm(world.organization);
    expect(scriptedModel.turns).toHaveLength(0);
    expect(await scheduledAlarm()).toBe(lastAt + 8_000);

    wait(1_000);
    await runDurableObjectAlarm(world.organization);

    expect(scriptedModel.turns).toHaveLength(1);
    expect(scriptedModel.turns[0]!.messages.at(-1)).toEqual({
      role: "user",
      content: "hola\nuna pregunta\ncuándo es mi turno?",
    });
    expect(textsToMeta()).toHaveLength(1);
  });

  it("answers a message that arrived during a turn in a turn of its own, not with the earlier reply", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    scriptedModel.script(async (turn) => {
      turn.call("judge_messages", notClinical);
      await released;
      return "Hola Martina";
    });
    wait(8_000);
    const alarm = runDurableObjectAlarm(world.organization);
    while (scriptedModel.turns.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await patientWrites("cuándo es mi turno?");
    release();
    await alarm;

    expect(textsToMeta()).toEqual([]);
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "El lunes 5 de enero a las 09:00";
    });
    await afterTheWait();
    expect(scriptedModel.turns).toHaveLength(2);
    expect(scriptedModel.turns[1]!.messages.at(-1)).toEqual({
      role: "user",
      content: "hola\ncuándo es mi turno?",
    });
    expect(textsToMeta()).toEqual([
      { to: "5491155550000", text: "El lunes 5 de enero a las 09:00" },
    ]);
  });

  it("sets no alarm for a turn while the Worker has no model API key", async () => {
    scriptedModel.hasApiKey = false;
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");

    expect(await scheduledAlarm()).toBeNull();
  });
});

describe("answering when, where and with whom", () => {
  it("replies with the appointment's date, time, practitioner and office, through the Graph API", async () => {
    const { appointmentId } = await bookPatient("Martina", martinaPhone);
    await patientWrites("cuándo tengo el turno?");
    let details: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      turn.call("list_patients");
      details = turn.call("get_appointment", { appointmentId });
      return "Tu turno es el lunes 5 de enero a las 09:00 con Juan Gómez en Sede Centro.";
    });

    await afterTheWait();

    expect(details).toEqual({
      ok: true,
      appointment: {
        medicalService: "Consulta",
        practitioner: "Juan Gómez",
        date: "lunes 5 de enero",
        time: "09:00",
        office: "Sede Centro",
        address: world.office.address,
      },
    });
    expect(textsToMeta()).toEqual([
      {
        to: "5491155550000",
        text: "Tu turno es el lunes 5 de enero a las 09:00 con Juan Gómez en Sede Centro.",
      },
    ]);
    expect((await storedMessages()).at(-1)).toMatchObject({
      whatsappId: "wamid.test-message",
      direction: "outgoing",
      text: "Tu turno es el lunes 5 de enero a las 09:00 con Juan Gómez en Sede Centro.",
      rulesVersion: 0,
    });
  });

  it("lists every patient a guardian's number stands for, and is told to ask which one first", async () => {
    const martina = await bookPatient("Martina", "+5493515550001");
    const tomas = await bookPatient("Tomás", "+5493515550002", at("12:30"));
    for (const { patientId } of [martina, tomas]) {
      const added = expectOk(
        await world.organization.addGuardian(adminCaller, {
          patientId,
          name: "Laura Gómez",
          relationship: "Madre",
          phone: martinaPhone,
        }),
      );
      expectOk(
        await world.organization.setMessageContact(adminCaller, {
          patientId,
          guardianId: added.guardian.id,
        }),
      );
    }
    await patientWrites("a qué hora es el turno?");
    let listed: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      listed = turn.call("list_patients");
      return "Es para Martina o para Tomás?";
    });

    await afterTheWait();

    expect(listed).toEqual({
      patients: expect.arrayContaining([
        expect.objectContaining({ patientId: martina.patientId, firstName: "Martina" }),
        expect.objectContaining({ patientId: tomas.patientId, firstName: "Tomás" }),
      ]),
    });
    expect(scriptedModel.turns[0]!.system).toContain(
      "If it lists more than one patient and the patient has not said which one, ask which one before telling or doing anything about an appointment.",
    );
    expect(textsToMeta()).toEqual([{ to: "5491155550000", text: "Es para Martina o para Tomás?" }]);
  });

  it("returns nothing about a patient whose contact is another number", async () => {
    await bookPatient("Martina", martinaPhone);
    const other = await bookPatient("Lucía", "+5493515559999", at("12:30"));
    await patientWrites("cuándo es el turno de Lucía?");
    let listed: { patients: { patientId: string }[] } | undefined;
    let read: unknown;
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      listed = turn.call("list_patients") as typeof listed;
      read = turn.call("get_appointment", { appointmentId: other.appointmentId });
      return "No tengo ese dato.";
    });

    await afterTheWait();

    expect(listed!.patients.map((patient) => patient.patientId)).not.toContain(other.patientId);
    expect(read).toEqual({ ok: false, reason: "notFound" });
  });

  it("says it is a bot when asked, as its prompt tells it", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("sos un bot?");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "Sí, soy el asistente automático del consultorio.";
    });

    await afterTheWait();

    expect(scriptedModel.turns[0]!.system).toContain(
      "If asked whether you are a bot or a person, say plainly that you are the practice's automated assistant.",
    );
    expect(textsToMeta()).toEqual([
      { to: "5491155550000", text: "Sí, soy el asistente automático del consultorio." },
    ]);
  });
});

describe("the organization's voice", () => {
  it("writes under the saved rules, signs off, passes the fixed checks and records the version", async () => {
    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        formOfAddress: "usted",
        signOff: "Consultorios Prueba",
        tone: "Cordial y breve.",
      }),
    );
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", notClinical);
      return "¿En qué lo puedo ayudar? 😊";
    });

    await afterTheWait();

    const { system } = scriptedModel.turns[0]!;
    expect(system).toContain('addressing the patient as "usted"');
    expect(system).toContain("Cordial y breve.");
    expect(textsToMeta()).toEqual([
      { to: "5491155550000", text: "En qué lo puedo ayudar?\nConsultorios Prueba" },
    ]);
    expect((await storedMessages()).at(-1)).toMatchObject({ rulesVersion: 1 });
  });
});

describe("judging every patient message", () => {
  it("stores the turn's judgement on each new message, and hides a clinical one from reception", async () => {
    await bookPatient("Martina", martinaPhone);
    const first = await patientWrites("hola");
    const second = await patientWrites("me duele mucho la muela");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { clinical: true, emergency: false });
      return "Le paso tu consulta a la profesional.";
    });

    await afterTheWait();

    expect(await storedMessages()).toEqual([
      expect.objectContaining({ whatsappId: first, judgement: "clinical", emergency: false }),
      expect.objectContaining({ whatsappId: second, judgement: "clinical", emergency: false }),
    ]);
    const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));
    const read = expectOk(
      await world.organization.readConversation(world.receptionist, {
        conversationId: listed.conversations[0]!.id,
      }),
    );
    expect(read.messages.map((message) => message.withheld)).toEqual(["clinical", "clinical"]);
    // A clinical message is not answered here: the handoff is #171's.
    expect(textsToMeta()).toEqual([]);
  });

  it("stores an emergency as one", async () => {
    await bookPatient("Martina", martinaPhone);
    const message = await patientWrites("no puedo respirar");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { clinical: true, emergency: true });
      return "Llamá al 107.";
    });

    await afterTheWait();

    expect(await storedMessages()).toEqual([
      expect.objectContaining({ whatsappId: message, judgement: "clinical", emergency: true }),
    ]);
    expect(textsToMeta()).toEqual([]);
  });

  it("judges an earlier message only once", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    await afterTheWait();
    await patientWrites("cuándo es mi turno?");
    scriptedModel.script((turn) => {
      turn.call("judge_messages", { clinical: true, emergency: false });
      return "Te paso con la profesional.";
    });

    await afterTheWait();

    expect(
      (await storedMessages())
        .filter((message) => message.direction === "incoming")
        .map((message) => message.judgement),
    ).toEqual(["notClinical", "clinical"]);
  });

  it("leaves a message unjudged and unanswered when the model judged nothing", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    scriptedModel.script(() => "Hola!");

    await afterTheWait();

    expect(await storedMessages()).toEqual([expect.objectContaining({ judgement: null })]);
    expect(textsToMeta()).toEqual([]);
  });

  it("leaves a message unjudged when the model fails, and runs the outbox all the same", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");
    scriptedModel.script(() => {
      throw new Error("The model is overloaded");
    });

    await afterTheWait();

    expect(await storedMessages()).toEqual([expect.objectContaining({ judgement: null })]);
    expect(await scheduledAlarm()).toBeNull();
  });
});

describe("who gets no reply from the assistant", () => {
  it("judges a number underthing does not know, and does not answer it", async () => {
    await patientWrites("hola, quiero un turno", "+5493515550123");

    await afterTheWait();

    expect(await storedMessages()).toEqual([expect.objectContaining({ judgement: "notClinical" })]);
    expect(textsToMeta()).toEqual([]);
  });

  it("judges a patient with no upcoming appointment, and does not answer them", async () => {
    await world.addPatient("Martina", martinaPhone);
    await patientWrites("hola");

    await afterTheWait();

    expect(await storedMessages()).toEqual([expect.objectContaining({ judgement: "notClinical" })]);
    expect(textsToMeta()).toEqual([]);
  });

  it("sends no free-form reply once the window has closed", async () => {
    await bookPatient("Martina", martinaPhone);
    // Meta delivered it late: the patient wrote a day and a minute ago.
    await patientWrites("hola", martinaPhone, Date.now() - 24 * 60 * 60_000 - 60_000);

    await afterTheWait();

    expect(scriptedModel.turns).toHaveLength(1);
    expect(await storedMessages()).toEqual([expect.objectContaining({ judgement: "notClinical" })]);
    expect(textsToMeta()).toEqual([]);
  });
});

describe("the conversation's wait", () => {
  it("is cleared once its turn has run", async () => {
    await bookPatient("Martina", martinaPhone);
    await patientWrites("hola");

    await afterTheWait();

    const waits = await inStorage(world.organization, (database) =>
      database
        .select({ dueAt: conversation.assistantDueAt })
        .from(conversation)
        .where(eq(conversation.phone, martinaPhone))
        .all(),
    );
    expect(waits).toEqual([{ dueAt: null }]);
  });
});
