import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { assistantWaitMs } from "#/lib/assistant.ts";

import {
  addRefusedAdmin,
  addStaff,
  adminCaller,
  afterTheWait,
  auditEntriesFor,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  patientSends,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
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

const notClinical = { healthQuestion: false, emergency: false };

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
  return listed.notifications
    .filter((one) => one.kind === "handoff")
    .map((one) => one.handoff && { ...one.handoff, patient: undefined, detail: undefined });
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

/** Submits template `templateId` with its draft, signed, and has Meta approve it at once. */
function approveTemplate(templateId: string, metaId: string) {
  return submitTemplate(world.organization, templateId, { status: "APPROVED", metaId });
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
  it("hands the conversation to the admins while no handoff contact is picked, not to the appointment's practitioner, and tells the patient nothing", async () => {
    const appointmentId = await bookMartina();
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked", appointmentId });
      return "Ya te paso con alguien.";
    });

    await turn();

    const [opened] = await openHandoffs();
    expect(opened).toMatchObject({
      reason: "patientAsked",
      forPractitioner: false,
      recipients: ["Ana Admin"],
    });
    expect(await notifiedOfHandoff(adminCaller)).toMatchObject([
      { conversationId: opened!.conversationId, reason: "patientAsked", forPractitioner: false },
    ]);
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([]);
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
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
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "clinical",
      forPractitioner: true,
      recipients: ["Lucía Díaz"],
    });
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([]);
    expect(await notifiedOfHandoff(world.receptionist)).toEqual([]);
  });

  it("is handed to the practitioner though the model did not hand it off, and its reply does not go", async () => {
    const appointmentId = await bookMartina();
    await writes("me sangra la encía");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      return "Ya dejé registrada tu consulta.";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "clinical",
      forPractitioner: true,
      recipients: ["Juan Gómez"],
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Le paso tu consulta a Juan Gómez.",
    ]);
  });

  it("shows a receptionist it with its words, and lets only a practitioner who keeps records close it", async () => {
    const appointmentId = await bookMartina();
    await writes("me duele la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "";
    });
    await turn();

    const [seen] = await openHandoffs(world.receptionist);
    expect(seen).toMatchObject({ forPractitioner: true, mayAnswer: false });
    expect(seen!.lastPatientMessage).toMatchObject({ text: "me duele la muela" });
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
      forPractitioner: false,
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Perdón, no te entendí. Me lo decís de otra forma?",
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
  it("hands an unknown number to the handoff contacts, telling it nothing", async () => {
    await contactsAre(world.lucia.caller, world.receptionist);
    await writes("hola, quiero un turno", unknownPhone);

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "unknownNumber",
      forPractitioner: false,
      recipients: ["Lucía Díaz", "Rita Paz"],
    });
    expect(await notifiedOfHandoff(world.receptionist)).toHaveLength(1);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("hands a health question from an unknown number to the handoff contacts, telling it nothing", async () => {
    await contactsAre(world.lucia.caller, world.receptionist);
    await writes("tengo la cara hinchada", unknownPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: true, emergency: false });
      return "Le paso tu consulta al profesional.";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "healthQuestion",
      forPractitioner: false,
      recipients: ["Lucía Díaz", "Rita Paz"],
    });
    expect(await notifiedOfHandoff(world.receptionist)).toHaveLength(1);
    expect(fakeMeta.textsSent()).toEqual([]);
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
  it("hands a request for another time to reception, not to the cancelled appointment's practitioner", async () => {
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
      one.call("hand_off", { reason: "organization_cancelled" });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      reason: "organizationCancelled",
      recipients: ["Ana Admin"],
    });
  });

  it("reaches the handoff contacts though the patient answered the cancellation before", async () => {
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
      one.call("hand_off", { reason: "organization_cancelled" });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toEqual([
      expect.objectContaining({ reason: "organizationCancelled", recipients: ["Lucía Díaz"] }),
    ]);
  });
});

describe("answering a follow-up", () => {
  async function followUpSent() {
    const followUpId = await templateNamed(world.organization, "Seguimiento");
    await submitTemplate(world.organization, followUpId, {
      status: "APPROVED",
      metaId: "900000000000023",
      timing: { when: "after", hours: 1 },
    });
    await world.pickTemplates(medicalServiceId, [followUpId]);
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

  it("hands an answer the model could not read to reception, not to the follow-up's practitioner", async () => {
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
      expect.objectContaining({
        reason: "modelUnavailable",
        forPractitioner: false,
        recipients: ["Ana Admin"],
      }),
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
      forPractitioner: false,
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
      // The follow-up's appointment is past: list_patients never gave the model its id.
      one.call("judge_messages", { healthQuestion: true, emergency: false });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      forPractitioner: true,
      recipients: ["Juan Gómez"],
    });
  });

  it("hands a photo sent as the answer to reception, telling the patient nothing", async () => {
    await followUpSent();
    await patientSends(world.organization, "image", martinaPhone);

    await turn();

    expect(scriptedModel.turns).toEqual([]);
    expect((await openHandoffs())[0]).toMatchObject({
      reason: "media",
      forPractitioner: false,
      recipients: ["Ana Admin"],
    });
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("hands a photo and words that answer it otherwise, sent together, to the practitioner", async () => {
    await followUpSent();
    await patientSends(world.organization, "image", martinaPhone);
    await writes("me molesta un poco al masticar");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, followUpAnswer: "other" });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toMatchObject([
      { reason: "followUpAnswer", forPractitioner: true, recipients: ["Juan Gómez"] },
    ]);
  });

  it("still sorts the words after a photo as the answer, to the practitioner when not plainly good", async () => {
    await followUpSent();
    await patientSends(world.organization, "image", martinaPhone);
    await turn();
    await writes("me molesta un poco al masticar");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, followUpAnswer: "other" });
      return "";
    });

    await turn();

    expect((await openHandoffs()).map((one) => [one.reason, one.forPractitioner])).toEqual([
      ["followUpAnswer", true],
      ["media", false],
    ]);
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
      forPractitioner: true,
      recipients: ["Juan Gómez"],
    });
    expect((await openHandoffs(world.receptionist))[0]!.lastPatientMessage).toMatchObject({
      text: "bien, pero me molesta un poco al masticar",
    });
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Le paso tu consulta a Juan Gómez.",
    ]);
  });
});

describe("an open handoff", () => {
  async function handedOff() {
    const appointmentId = await bookMartina();
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked", appointmentId });
      return "";
    });
    await turn();
    fakeMeta.requests = [];
    return appointmentId;
  }

  it("gets a handoff to the practitioner beside it for what needs one, and no second", async () => {
    const appointmentId = await handedOff();
    const judged = { healthQuestion: true, emergency: false, treatedBy: appointmentId };
    await writes("y me duele la muela");
    scriptedModel.script((one) => {
      one.call("judge_messages", judged);
      return "";
    });
    await turn();
    await writes("mucho");
    scriptedModel.script((one) => {
      one.call("judge_messages", judged);
      return "";
    });
    await turn();

    expect((await openHandoffs()).map((one) => one.forPractitioner)).toEqual([true, false]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Le paso tu consulta a Juan Gómez.",
    ]);
  });

  it("stays open once its notification is read", async () => {
    await handedOff();
    const listed = expectOk(await world.organization.listNotifications(adminCaller));
    expectOk(
      await world.organization.markNotificationRead(adminCaller, {
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
        await world.organization.passToPractitioner(caller, { handoffId: opened!.id }),
      ).toEqual(refused);
    }
    expect(await openHandoffs()).toHaveLength(1);
  });

  it("is not listed to a practitioner it was not handed to, the appointment's included", async () => {
    await handedOff();

    expect(await openHandoffs(world.lucia.caller)).toEqual([]);
    expect(await openHandoffs(world.juan.caller)).toEqual([]);
    expect(await openHandoffs(world.receptionist)).toHaveLength(1);
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

describe("what the patient is told on a handoff (#290)", () => {
  it("names the appointment's practitioner on a handoff to them", async () => {
    const appointmentId = await bookMartina();
    await writes("me sangra la encía desde ayer, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "";
    });

    await turn();

    expect((await openHandoffs())[0]).toMatchObject({
      forPractitioner: true,
      recipients: ["Juan Gómez"],
    });
    expect(fakeMeta.textsSent()).toEqual([
      { to: "5491155550000", text: "Le paso tu consulta a Juan Gómez." },
    ]);
  });

  it("sends a health question its appointment's practitioner does not treat to reception, telling the patient nothing", async () => {
    // Juan's appointment is not what the patient asks about, so the model names no treatedBy.
    await bookMartina();
    await writes("me duele una muela, tomo algo?");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: true, emergency: false });
      one.call("hand_off", { reason: "clinical" });
      return "Consultá con tu odontólogo.";
    });

    await turn();

    expect(await openHandoffs()).toMatchObject([
      { reason: "healthQuestion", forPractitioner: false, recipients: ["Ana Admin"] },
    ]);
    expect(await notifiedOfHandoff(world.juan.caller)).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
  });

  it("names no practitioner for an appointment the turn could not speak of", async () => {
    const appointmentId = await bookMartina();
    await writes("me duele una muela, tomo algo?");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: "an-appointment-of-nobody",
      });
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toMatchObject([{ reason: "healthQuestion" }]);
  });

  it("reaches a solo practitioner who is also the admin, of either kind, in their one inbox", async () => {
    const solo = await addStaff(world.organization, "Sol Paz", ["admin", "practitioner"]);
    await writes("quiero hablar con alguien", unknownPhone);
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked" });
      return "";
    });
    await turn();
    await writes("me caí y me sangra mucho la boca", unknownPhone);
    scriptedModel.script((one) => {
      // An emergency needs the practitioner though the model said it did not.
      one.call("judge_messages", { healthQuestion: false, emergency: true });
      return "";
    });
    await turn();

    const reasons = (await notifiedOfHandoff(solo.caller)).map((one) => one?.reason);
    expect(reasons).toEqual(expect.arrayContaining(["emergency", "patientAsked"]));
    expect(reasons).toHaveLength(2);
    expect((await openHandoffs(solo.caller)).map((one) => one.mayAnswer)).toEqual([true, true]);
  });
});

describe("a handoff to the practitioner when nobody keeps clinical records (#285)", () => {
  it("reaches the admins with its words, who are told why and may answer it", async () => {
    await juanKeepsNoClinicalRecords();
    await inStorage(world.organization, (database) =>
      database
        .update(practitioner)
        .set({ keepsClinicalRecords: false })
        .where(eq(practitioner.id, world.lucia.practitionerId))
        .run(),
    );
    const appointmentId = await bookMartina();
    await writes("me duele la muela, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      return "";
    });

    await turn();

    const [seen] = await openHandoffs();
    expect(seen).toMatchObject({
      forPractitioner: true,
      recipients: ["Ana Admin"],
      mayAnswer: true,
      lastPatientMessage: { text: "me duele la muela, es normal?" },
    });
    expect(await notifiedOfHandoff(adminCaller)).toMatchObject([{ noPractitioner: true }]);
    expectOk(await world.organization.closeHandoff(adminCaller, { handoffId: seen!.id }));
  });
});

describe("the assistant while a handoff is open (#290)", () => {
  it("answers a new request it can handle, and opens no second handoff of the same kind", async () => {
    await bookMartina();
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked" });
      return "";
    });
    await turn();
    await writes("ah, y a qué hora era el turno?");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      return "Es el lunes 5 de enero a las 09:00.";
    });

    await turn();

    // The model is told of the open handoff, so it leaves that topic to the person.
    expect(scriptedModel.turns.at(-1)?.system).not.toBe(scriptedModel.turns[0]?.system);
    expect(fakeMeta.textsSent()).toEqual([
      { to: "5491155550000", text: "Es el lunes 5 de enero a las 09:00." },
    ]);
    expect(await openHandoffs()).toHaveLength(1);
  });
});

describe("a photo from the patient (#290)", () => {
  it("goes to reception, telling the patient nothing, and reception passes it to the practitioner", async () => {
    await bookMartina();
    await patientSends(world.organization, "image", martinaPhone);

    await turn();

    const [opened] = await openHandoffs(world.receptionist);
    expect(opened).toMatchObject({
      reason: "media",
      forPractitioner: false,
      recipients: ["Ana Admin"],
      mayPass: true,
      lastPatientMessage: { type: "image" },
    });
    expect(fakeMeta.textsSent()).toEqual([]);

    expectOk(
      await world.organization.passToPractitioner(world.receptionist, { handoffId: opened!.id }),
    );

    expect((await openHandoffs(world.receptionist))[0]).toMatchObject({
      reason: "media",
      forPractitioner: true,
      recipients: ["Juan Gómez", "Lucía Díaz"],
      mayPass: false,
      mayAnswer: false,
    });
    expect(await notifiedOfHandoff(world.juan.caller)).toMatchObject([{ reason: "media" }]);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(
      await world.organization.passToPractitioner(world.receptionist, { handoffId: opened!.id }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("a burst that mixes an easy request with one for the practitioner (#290)", () => {
  it("does the easy part, says it after the clinical check, then hands the rest to the practitioner", async () => {
    const appointmentId = await bookMartina();
    await writes("Hola, quería confirmar el turno del lunes");
    await writes("Me sigue doliendo la muela de abajo, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      one.call("propose_change", { appointmentId, kind: "confirm" });
      one.call("accept_proposal");
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "Listo, confirmado el lunes.";
    });

    await turn();

    expect((await world.appointmentOf(appointmentId)).status).toBe("confirmed");
    expect(scriptedModel.checks.map((check) => check.reply)).toEqual([
      "Listo, confirmado el lunes.",
    ]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Listo, confirmado el lunes.",
      "Le paso tu consulta a Juan Gómez.",
    ]);
    expect(await openHandoffs()).toMatchObject([
      { forPractitioner: true, recipients: ["Juan Gómez"] },
    ]);
  });
});

describe("a health question while a handoff to the practitioner is open (#290)", () => {
  it("opens nothing for reception, and the assistant's reply goes", async () => {
    const appointmentId = await bookMartina();
    await writes("me duele la muela desde ayer, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: appointmentId,
      });
      return "";
    });
    await turn();
    await writes("y entonces tomo algo?");
    scriptedModel.script((one) => {
      one.call("judge_messages", { healthQuestion: true, emergency: false });
      return "Ya se lo pasé, te va a responder por acá.";
    });

    await turn();

    expect((await openHandoffs()).map((one) => one.reason)).toEqual(["clinical"]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Le paso tu consulta a Juan Gómez.",
      "Ya se lo pasé, te va a responder por acá.",
    ]);
  });
});

describe("an emergency the model handed off", () => {
  it("is one though the judgement did not call it so: the practitioner who treats it has it, and the emergency reply goes", async () => {
    const appointmentId = await bookMartina();
    await writes("me caí y me sangra mucho la boca");
    scriptedModel.script((one) => {
      one.call("judge_messages", { ...notClinical, treatedBy: appointmentId });
      one.call("hand_off", { reason: "emergency" });
      return "";
    });

    await turn();

    expect(await openHandoffs()).toMatchObject([
      { reason: "emergency", forPractitioner: true, recipients: ["Juan Gómez"] },
    ]);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([expect.stringContaining("107")]);
  });
});

describe("a hand_off of a kind already open (#290)", () => {
  it("opens no second handoff, and the reply about the new request goes", async () => {
    const appointmentId = await bookMartina();
    const judged = { healthQuestion: true, emergency: false, treatedBy: appointmentId };
    await writes("me duele la muela desde ayer, es normal?");
    scriptedModel.script((one) => {
      one.call("judge_messages", judged);
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "";
    });
    await turn();
    await writes("y a qué hora era el turno?");
    scriptedModel.script((one) => {
      one.call("judge_messages", judged);
      one.call("hand_off", { reason: "clinical", appointmentId });
      return "Es el lunes 5 de enero a las 09:00.";
    });

    await turn();

    expect(await openHandoffs()).toHaveLength(1);
    expect(fakeMeta.textsSent().map((sent) => sent.text)).toEqual([
      "Le paso tu consulta a Juan Gómez.",
      "Es el lunes 5 de enero a las 09:00.",
    ]);
  });
});
