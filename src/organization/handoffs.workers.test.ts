import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { assistantWaitMs } from "#/lib/assistant.ts";
import { whatsappTemplates } from "#/lib/whatsapp-templates.ts";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";

import {
  addRefusedAdmin,
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
import type { Caller } from "#/organization/members.ts";
import { practitioner } from "#/organization/schema.ts";
import { handoff } from "#/organization/whatsapp-schema.ts";

// Handoffs (docs/domain/assistant.md § Handoff), through the object's
// methods: the assistant's turn opens one, its recipients are notified, the
// inbox lists it by each reader's rules, and a person closes it. Meta is
// faked at its HTTP boundary and the model scripted at its port.

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

const handedOffText =
  "Gracias por escribirnos. Le pasamos tu mensaje a una persona del equipo, que te va a responder por acá.";

const notClinical = { clinical: false, emergency: false };

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;

function writes(text: string, from = martinaPhone) {
  return patientWrites(world.organization, text, from);
}

function turn() {
  return afterTheWait(world.organization);
}

/** Books Martina with Juan at 09:00 in Buenos Aires on the first Monday. */
async function bookMartina() {
  const patient = await world.addPatient("Martina", martinaPhone);
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start: at("12:00"),
    durationMinutes: 30,
  });
  return booked.id;
}

/** The open handoffs `caller` sees in the inbox. */
async function openHandoffs(caller: Caller = adminCaller) {
  return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs;
}

/** Who has a handoff notification, by caller. */
async function notifiedOfHandoff(caller: Caller) {
  const listed = expectOk(await world.organization.listNotifications(caller));
  return listed.notifications.filter((one) => one.kind === "handoff").map((one) => one.handoff);
}

/** Makes `members` the handoff contacts. */
async function contactsAre(...members: Caller[]) {
  expectOk(
    await world.organization.saveHandoffContacts(adminCaller, {
      memberIds: members.map((one) => one.userId),
    }),
  );
}

function juanKeepsNoClinicalRecords() {
  return inStorage(world.organization, (database) =>
    database
      .update(practitioner)
      .set({ keepsClinicalRecords: false })
      .where(eq(practitioner.id, world.juan.practitionerId))
      .run(),
  );
}

/** Submits `templateName` with its draft, signed, and has Meta approve it at once. */
async function approveTemplate(templateName: TemplateName, metaId: string) {
  const body = whatsappTemplates[templateName].draft.replace("[firma]", "Consultorios Prueba");
  fakeMeta.answerNextWith(200, { id: metaId, status: "APPROVED", category: "UTILITY" });
  expectOk(await world.organization.submitWhatsappTemplate(adminCaller, { templateName, body }));
  fakeMeta.requests = [];
}

beforeEach(async () => {
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

describe("a patient asking for a person", () => {
  it("hands the conversation to the appointment's practitioner, who alone is notified", async () => {
    const appointmentId = await bookMartina();
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked", clinical: false, appointmentId });
      return "Ya te paso con alguien.";
    });

    await turn();

    const [opened] = await openHandoffs();
    expect(opened).toMatchObject({
      reason: "patientAsked",
      clinical: false,
      recipients: ["Juan Gómez"],
    });
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([
      { conversationId: opened!.conversationId, reason: "patientAsked", clinical: false },
    ]);
    expect(await notifiedOfHandoff(world.lucia.caller)).toEqual([]);
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: handedOffText }]);
  });

  it("ignores an appointment id the number may not speak of", async () => {
    await bookMartina();
    const other = await world.addPatient("Pedro", "+5491155559999");
    await world.addSchedule({
      practitionerId: world.lucia.practitionerId,
      roomId: world.otherRoom.id,
    });
    const othersAppointment = await world.book({
      practitionerId: world.lucia.practitionerId,
      patientId: other.id,
      medicalServiceId: (await world.addMedicalService(world.lucia.practitionerId)).id,
      start: at("12:00"),
      durationMinutes: 30,
    });
    await contactsAre(world.juan.caller);
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", {
        reason: "patient_asked",
        clinical: false,
        appointmentId: othersAppointment.id,
      });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]!.recipients).toEqual(["Juan Gómez"]);
    expect(await notifiedOfHandoff(world.lucia.caller)).toEqual([]);
  });
});

describe("a clinical question", () => {
  it("goes to the handoff contacts who keep clinical records when the appointment's practitioner does not", async () => {
    const appointmentId = await bookMartina();
    await juanKeepsNoClinicalRecords();
    await contactsAre(world.lucia.caller, world.receptionist);
    await writes("me duele la muela desde ayer, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      one.call("hand_off", { reason: "clinical", clinical: true, appointmentId });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "clinical",
      clinical: true,
      recipients: ["Lucía Díaz"],
    });
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([]);
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
  });

  it("withholds the words of a message the model handed off as clinical though it judged it not clinical", async () => {
    const appointmentId = await bookMartina();
    await writes("me sangra la encía");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "clinical", clinical: true, appointmentId });
      return "";
    });

    await turn();

    const [seen] = await openHandoffs(world.receptionist);
    expect(seen!.lastPatientMessage).toMatchObject({ withheld: "clinical" });
  });

  it("is handed off as clinical though the model did not hand it off", async () => {
    await bookMartina();
    await writes("me sangra la encía");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      return "Que no sea nada.";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({ reason: "clinical", clinical: true });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([handedOffText]);
  });

  it("shows a receptionist that it is open, without its words, and lets only a practitioner who keeps records close it", async () => {
    const appointmentId = await bookMartina();
    await writes("me duele la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      one.call("hand_off", { reason: "clinical", clinical: true, appointmentId });
      return "";
    });
    await turn();

    const [seen] = await openHandoffs(world.receptionist);
    expect(seen).toMatchObject({ clinical: true, mayClose: false });
    expect(seen!.lastPatientMessage).toMatchObject({ withheld: "clinical" });
    expect(seen!.lastPatientMessage).not.toHaveProperty("text");
    const [juans] = await openHandoffs(world.juan.caller);
    expect(juans!.lastPatientMessage).toMatchObject({ text: "me duele la muela" });

    expect(
      await world.organization.closeHandoff(world.receptionist, { handoffId: seen!.id }),
    ).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expectOk(await world.organization.closeHandoff(world.juan.caller, { handoffId: seen!.id }));
    expect(await openHandoffs()).toEqual([]);
  });
});

describe("misunderstanding the patient", () => {
  function misunderstands() {
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, understood: false });
      return "Perdón, no te entendí. ¿Me lo decís de otra forma?";
    });
  }

  it("asks again after one misunderstanding, and hands off after a second in a row", async () => {
    await bookMartina();
    await writes("che lo del otro día");
    misunderstands();
    await turn();

    expect(await openHandoffs()).toEqual([]);

    await writes("eso que hablamos");
    misunderstands();
    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "misunderstoodTwice",
      clinical: false,
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Perdón, no te entendí. Me lo decís de otra forma?",
      handedOffText,
    ]);
  });

  it("counts again from an understood message in between", async () => {
    await bookMartina();
    await writes("che lo del otro día");
    misunderstands();
    await turn();
    await writes("cuándo es mi turno?");
    await turn();
    await writes("y lo otro?");
    misunderstands();
    await turn();

    expect(await openHandoffs()).toEqual([]);
  });
});

describe("a number with nothing booked to talk about", () => {
  it("gets the short reply from an unknown number, and a handoff to the handoff contacts", async () => {
    await contactsAre(world.lucia.caller, world.receptionist);
    await writes("hola, quiero un turno", unknownPhone);

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "unknownNumber",
      clinical: false,
      recipients: ["Lucía Díaz", "Rita Paz"],
    });
    expect(await notifiedOfHandoff(world.receptionist)).toHaveLength(1);
    expect(fakeMeta.textsSent()).toEqual([{ to: "5493515550123", text: handedOffText }]);
  });

  it("hands a clinical message from an unknown number only to the contacts who keep clinical records", async () => {
    await contactsAre(world.lucia.caller, world.receptionist);
    await writes("tengo la cara hinchada", unknownPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({ clinical: true, recipients: ["Lucía Díaz"] });
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
  });

  it("hands off a patient with no upcoming appointment", async () => {
    await contactsAre(world.lucia.caller);
    await world.addPatient("Martina", martinaPhone);
    await writes("quiero sacar un turno");

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({ reason: "noUpcomingAppointment" });
  });

  it("goes to every admin while no handoff contact is picked", async () => {
    await writes("hola", unknownPhone);

    await turn();

    expect(await notifiedOfHandoff(adminCaller)).toHaveLength(1);
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
  });
});

describe("an appointment the organization cancelled", () => {
  it("hands a request for another time to the cancelled appointment's practitioner", async () => {
    await approveTemplate("turno_cancelado", "900000000000022");
    const appointmentId = await bookMartina();
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "business",
      }),
    );
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + 60_000);
    await writes("uh, me das otro horario?");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "organization_cancelled", clinical: false });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "organizationCancelled",
      recipients: ["Juan Gómez"],
    });
  });

  it("reaches the cancelled appointment's practitioner though the patient answered the cancellation before", async () => {
    await approveTemplate("turno_cancelado", "900000000000022");
    const martina = await world.addPatient("Martina", martinaPhone);
    const booking = {
      practitionerId: world.juan.practitionerId,
      patientId: martina.id,
      medicalServiceId,
      durationMinutes: 30,
    };
    const { id: appointmentId } = await world.book({ ...booking, start: at("12:00") });
    // Another appointment, so answering the cancellation is not a number with nothing booked.
    await world.book({ ...booking, start: at("12:00", "2099-01-12") });
    await contactsAre(world.lucia.caller);
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "business",
      }),
    );
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + 60_000);
    await writes("ok");
    await turn();
    await writes("me das otro horario?");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "organization_cancelled", clinical: false });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toEqual([
      expect.objectContaining({ reason: "organizationCancelled", recipients: ["Juan Gómez"] }),
    ]);
  });

  it("is not clinical, so it reaches a practitioner who keeps no clinical records", async () => {
    await approveTemplate("turno_cancelado", "900000000000022");
    const appointmentId = await bookMartina();
    await juanKeepsNoClinicalRecords();
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "business",
      }),
    );
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(Date.now() + 60_000);
    await writes("me das otro horario?");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "organization_cancelled", clinical: false });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      clinical: false,
      recipients: ["Juan Gómez"],
    });
  });
});

describe("answering a follow-up", () => {
  async function followUpSent() {
    await approveTemplate("seguimiento", "900000000000023");
    expectOk(
      await world.organization.updateMedicalService(adminCaller, {
        medicalServiceId,
        name: "Consulta",
        durationMinutes: 30,
        bookingConfirmation: false,
        reminders: [],
        careInstructions: null,
        followUpHours: 1,
        rescheduleCutoffHours: 24,
      }),
    );
    const appointmentId = await bookMartina();
    vi.setSystemTime(at("12:30"));
    expectOk(
      await world.organization.changeAppointmentStatus(adminCaller, {
        appointmentId,
        status: "attended",
      }),
    );
    vi.setSystemTime(at("13:31"));
    await runDurableObjectAlarm(world.organization);
    fakeMeta.requests = [];
    vi.setSystemTime(Date.now() + 60_000);
    return appointmentId;
  }

  it("thanks a plainly good answer, and hands off nothing", async () => {
    await followUpSent();
    await writes("muy bien, gracias!");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, followUpAnswer: "plainlyGood" });
      return "Qué bueno, gracias por contarnos.";
    });

    await turn();

    expect(await openHandoffs()).toEqual([]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Qué bueno, gracias por contarnos.",
    ]);
  });

  it("hands an answer the model could not read to the follow-up's practitioner", async () => {
    await followUpSent();
    const sentAt = Date.now();
    await writes("me sigue doliendo");
    for (let i = 0; i < 100; i += 1) {
      scriptedModel.script(() => {
        throw new Error("The model is overloaded");
      });
    }
    await turn();

    const handOffAt = sentAt + 18 * 60 * 60_000;
    for (let i = 0; i < 100 && (await openHandoffs()).length === 0; i += 1) {
      vi.setSystemTime(Math.min(Date.now() + 60 * 60_000, handOffAt));
      await runDurableObjectAlarm(world.organization);
    }

    expect(await openHandoffs()).toEqual([
      expect.objectContaining({ reason: "modelUnavailable", recipients: ["Juan Gómez"] }),
    ]);
  });

  it("answers an opt-out as one, not as the practitioner's", async () => {
    await followUpSent();
    await writes("no me escriban más");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, optOut: true });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toEqual([]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Entendido. Le avisamos al equipo para que no te enviemos más mensajes por WhatsApp.",
    ]);
  });

  it.each([
    { judged: "an opt-out", followUpAnswer: undefined },
    { judged: "a good answer and an opt-out", followUpAnswer: "plainlyGood" as const },
  ])(
    "hands $judged off when reception sent the patient's messages elsewhere while the model wrote",
    async ({ followUpAnswer }) => {
      const { patientId } = await world.appointmentOf(await followUpSent());
      const added = expectOk(
        await world.organization.addGuardian(adminCaller, {
          patientId,
          name: "Laura Gómez",
          relationship: "Madre",
          phone: "+5493515550009",
        }),
      );
      await writes("no me escriban más");
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      scriptedModel.script(async (one) => {
        one.call("judge_messages", { ...notClinical, optOut: true, followUpAnswer });
        await released;
        return "";
      });
      vi.setSystemTime(Date.now() + assistantWaitMs);
      const alarm = runDurableObjectAlarm(world.organization);
      while (scriptedModel.turns.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expectOk(
        await world.organization.setMessageContact(adminCaller, {
          patientId,
          guardianId: added.guardian.id,
        }),
      );
      release();
      await alarm;

      // Nobody is left on the number to turn off: the follow-up's practitioner answers it.
      expect(await openHandoffs()).toEqual([
        expect.objectContaining({ reason: "followUpAnswer", recipients: ["Juan Gómez"] }),
      ]);
    },
  );

  it("sorts only the first turn after it: a later message is not its answer", async () => {
    await followUpSent();
    await writes("muy bien!");
    // A thank-you with no words of its own does not go, so the follow-up stays the latest message out.
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, followUpAnswer: "plainlyGood" });
      return "";
    });
    await turn();
    await writes("cuándo puedo sacar otro turno?");

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "noUpcomingAppointment",
      clinical: false,
    });
  });

  it("hands a clinical message after the first answer to the follow-up's practitioner", async () => {
    await followUpSent();
    await contactsAre(world.lucia.caller);
    await writes("muy bien!");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, followUpAnswer: "plainlyGood" });
      return "";
    });
    await turn();
    await writes("bueno, me duele un poco");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({ clinical: true, recipients: ["Juan Gómez"] });
  });

  it("hands any other answer to the practitioner as clinical", async () => {
    await followUpSent();
    await writes("bien, pero me molesta un poco al masticar");
    scriptedModel.script((one) => {
      // A follow-up's answer is clinical whatever the model judged it.
      one.call("judge_messages", { ...notClinical, followUpAnswer: "other" });
      return "Tomá un analgésico.";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "followUpAnswer",
      clinical: true,
      recipients: ["Juan Gómez"],
    });
    expect((await openHandoffs(world.receptionist))[0]!.lastPatientMessage).toMatchObject({
      withheld: "clinical",
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([handedOffText]);
  });
});

describe("an open handoff", () => {
  async function handedOff() {
    const appointmentId = await bookMartina();
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked", clinical: false, appointmentId });
      return "";
    });
    await turn();
    fakeMeta.requests = [];
  }

  it("keeps the assistant silent in the conversation, though it still judges", async () => {
    await handedOff();
    await writes("hola? cuándo es mi turno?");

    await turn();

    expect(scriptedModel.turns).toHaveLength(2);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("gets a clinical handoff beside it for a clinical message, and no other", async () => {
    await handedOff();
    await writes("y me duele la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      return "";
    });
    await turn();
    await writes("mucho");
    scriptedModel.script((one) => {
      one.call("judge_messages", { clinical: true, emergency: false });
      return "";
    });
    await turn();

    expect((await openHandoffs()).map((one) => one.clinical)).toEqual([true, false]);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("stays open once its notification is read", async () => {
    await handedOff();
    const listed = expectOk(await world.organization.listNotifications(world.juan.caller));
    expectOk(
      await world.organization.markNotificationRead(world.juan.caller, {
        notificationId: listed.notifications[0]!.id,
      }),
    );

    expect(await openHandoffs()).toHaveLength(1);
  });

  it("is closed without a reply by a member who reads the conversation, who is recorded", async () => {
    await handedOff();
    const [opened] = await openHandoffs(world.receptionist);

    expectOk(await world.organization.closeHandoff(world.receptionist, { handoffId: opened!.id }));

    expect(await openHandoffs()).toEqual([]);
    const closed = await inStorage(world.organization, (database) =>
      database
        .select({ state: handoff.state, closedBy: handoff.closedBy })
        .from(handoff)
        .where(eq(handoff.id, opened!.id))
        .get(),
    );
    expect(closed).toEqual({ state: "closed", closedBy: world.receptionist.userId });
    expect(await auditEntriesFor(world.organization, opened!.id)).toEqual([
      expect.objectContaining({
        action: "update",
        entityType: "handoff",
        userId: world.receptionist.userId,
        before: { state: "open" },
        after: { state: "closed" },
      }),
    ]);
    expect(
      await world.organization.closeHandoff(world.receptionist, { handoffId: opened!.id }),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("lets the assistant answer again once closed", async () => {
    await handedOff();
    const [opened] = await openHandoffs();
    expectOk(await world.organization.closeHandoff(adminCaller, { handoffId: opened!.id }));
    await writes("gracias, ya está");

    await turn();

    expect(fakeMeta.textsSent()).toHaveLength(1);
  });

  it("refuses a caller who is not a member in good standing, and closes nothing", async () => {
    await handedOff();
    const [opened] = await openHandoffs();
    const callers = [
      [await addRefusedAdmin(world.organization, "mustChangePassword"), "mustChangePassword"],
      [await addRefusedAdmin(world.organization, "deactivated"), "unauthenticated"],
      [{ userId: "user-of-nobody" }, "unauthenticated"],
    ] as const;

    for (const [caller, reason] of callers) {
      const refused = { ok: false, reason };
      expect(await world.organization.listOpenHandoffs(caller, {})).toEqual(refused);
      expect(await world.organization.closeHandoff(caller, { handoffId: opened!.id })).toEqual(
        refused,
      );
      expect(
        await world.organization.reportOptOut(caller, {
          handoffId: opened!.id,
          throughMessageId: opened!.lastPatientMessage!.id,
        }),
      ).toEqual(refused);
    }
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("is not listed to a practitioner it does not concern", async () => {
    await handedOff();

    expect(await openHandoffs(world.lucia.caller)).toEqual([]);
    expect(await openHandoffs(world.juan.caller)).toHaveLength(1);
  });
});

describe("a practitioner a handoff went to", () => {
  it("reads the conversation of an unknown number handed to them", async () => {
    await contactsAre(world.lucia.caller);
    await writes("hola", unknownPhone);
    await turn();

    const [opened] = await openHandoffs(world.lucia.caller);

    expectOk(
      await world.organization.readConversation(world.lucia.caller, {
        conversationId: opened!.conversationId,
      }),
    );
  });
});
