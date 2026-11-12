import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addRefusedAdmin,
  adminCaller,
  afterTheWait,
  at,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  patientSends,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import type { Caller } from "#/organization/members.ts";
import { handoff } from "#/organization/whatsapp-schema.ts";

// What the assistant never answers itself (docs/domain/assistant.md § Rules
// it always keeps), through the object's methods: a reply the clinical check
// flags is held for the handoff's practitioner to send, fix or drop; an
// emergency gets the fixed reply; a photo or a file never reaches the model.
// Meta is faked at its HTTP boundary and the model, with its check, scripted
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

/** What the patient is told when a held reply hands the conversation to the practitioner. */
const toPractitionerText = "Le paso tu consulta al profesional.";

const notClinical = { needsPractitioner: false, emergency: false };

/** What the model wrote, which the check finds clinical. */
const clinicalReply = "Tranquila, ese dolor es normal después de una extracción.";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

function writes(text: string) {
  return patientWrites(world.organization, text, martinaPhone);
}

function turn() {
  return afterTheWait(world.organization);
}

/** The open handoffs `caller` sees in the inbox. */
async function openHandoffs(caller: Caller = adminCaller) {
  return expectOk(await world.organization.listOpenHandoffs(caller, {})).handoffs;
}

async function conversationOf(caller: Caller) {
  const listed = expectOk(await world.organization.listConversations(caller, {}));
  return expectOk(
    await world.organization.readConversation(caller, {
      conversationId: listed.conversations[0]!.id,
    }),
  );
}

/** Every handoff's held reply as stored, which no method shows once the handoff is closed. */
function heldRepliesStored() {
  return inStorage(world.organization, (database) =>
    database
      .select({ heldReply: handoff.heldReply })
      .from(handoff)
      .all()
      .map((one) => one.heldReply),
  );
}

/** Books Martina with `lucia` too, who still reads no conversation of hers, since no handoff goes to her. */
async function bookMartinaWithLucia() {
  await world.addSchedule({
    practitionerId: world.lucia.practitionerId,
    roomId: world.otherRoom.id,
  });
  const medicalServiceId = (await world.addMedicalService(world.lucia.practitionerId)).id;
  const [martina] = expectOk(await world.organization.listConversations(adminCaller, {}))
    .conversations[0]!.patients;
  await world.book({
    practitionerId: world.lucia.practitionerId,
    patientId: martina!.id,
    medicalServiceId,
    start: at("13:00"),
    durationMinutes: 30,
    // Martina already has an appointment that day, with Juan.
    confirmWarnings: true,
  });
}

/** A turn whose model answers `hola` with `reply`, which the check then finds `found`. */
async function modelAnswers(reply: string, found: { clinical: boolean; otherPatient: boolean }) {
  await writes("hola, me sacaron la muela ayer");
  scriptedModel.script((one) => {
    one.call("judge_messages", notClinical);
    return reply;
  });
  scriptedModel.scriptCheck(found);
  await turn();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  const medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  const patient = await world.addPatient("Martina", martinaPhone);
  await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start: at("12:00"),
    durationMinutes: 30,
  });
  // Juan alone takes the handoffs that concern no appointment, clinical ones included.
  expectOk(
    await world.organization.saveHandoffContacts(adminCaller, {
      memberIds: [world.juan.caller.userId],
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the clinical check", () => {
  it("is asked about the whole reply that would go, with the patients the number may hear about", async () => {
    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        formOfAddress: "vos",
        tone: "",
        phone: "",
      }),
    );
    await modelAnswers("Hola Martina, tu turno es el lunes.", {
      clinical: false,
      otherPatient: false,
    });

    const sent = "Hola Martina, tu turno es el lunes.";
    expect(scriptedModel.checks).toEqual([
      expect.objectContaining({ reply: sent, patients: ["Martina"] }),
    ]);
    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: sent }]);
  });

  it("holds a clinical reply unsent, and hands the conversation off as clinical with it", async () => {
    await modelAnswers(clinicalReply, { clinical: true, otherPatient: false });

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: toPractitionerText }]);
    const [held] = await openHandoffs(world.juan.caller);
    expect(held).toMatchObject({
      reason: "heldReply",
      forPractitioner: true,
      heldReply: clinicalReply,
    });
    expect(held!.recipients).toEqual(["Juan Gómez"]);
  });

  it("holds a reply about a patient other than the number's own", async () => {
    await modelAnswers("Lucía tiene turno el martes.", { clinical: false, otherPatient: true });

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: toPractitionerText }]);
    const [held] = await openHandoffs(world.juan.caller);
    expect(held).toMatchObject({ reason: "heldReply", heldReply: "Lucía tiene turno el martes." });
  });

  it("holds the reply when the check could not run", async () => {
    await writes("hola");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      return "Hola, en qué te ayudo?";
    });
    scriptedModel.scriptCheck("fails");
    await turn();

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: toPractitionerText }]);
    expect(await openHandoffs(world.juan.caller)).toMatchObject([
      { reason: "heldReply", heldReply: "Hola, en qué te ayudo?" },
    ]);
  });

  it("is not asked about a fixed reply", async () => {
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked" });
      return "Ya te paso con alguien.";
    });
    await turn();

    expect(scriptedModel.checks).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
  });
});

describe("a held reply", () => {
  beforeEach(async () => {
    await modelAnswers(clinicalReply, { clinical: true, otherPatient: false });
  });

  it("is shown to reception and the admins, who may not send or fix it", async () => {
    expect(await openHandoffs(world.receptionist)).toMatchObject([
      { heldReply: clinicalReply, mayUseHeldReply: false },
    ]);
    expect(await openHandoffs(adminCaller)).toMatchObject([
      { heldReply: clinicalReply, mayUseHeldReply: false },
    ]);
    expect(await openHandoffs(world.juan.caller)).toMatchObject([{ mayUseHeldReply: true }]);
  });

  it("is sent by its practitioner through their reply, which closes the handoff", async () => {
    const conversation = await conversationOf(world.juan.caller);
    const data = { conversationId: conversation.conversation.id };
    expectOk(await world.organization.takeOverConversation(world.juan.caller, data));
    expectOk(
      await world.organization.replyToConversation(world.juan.caller, {
        ...data,
        text: "Es esperable, pero si sigue mañana vení a verme.",
      }),
    );

    expect(fakeMeta.textsSent().at(-1)?.text).toContain("si sigue mañana vení a verme");
    expect(await openHandoffs(world.juan.caller)).toEqual([]);
    expect(await heldRepliesStored()).toEqual([null]);
  });

  it("is not kept once its handoff is closed without a reply", async () => {
    const [held] = await openHandoffs(world.juan.caller);

    expectOk(await world.organization.closeHandoff(world.juan.caller, { handoffId: held!.id }));

    expect(await heldRepliesStored()).toEqual([null]);
  });

  it("is dropped by its practitioner, leaving the handoff open", async () => {
    const [held] = await openHandoffs(world.juan.caller);

    expectOk(await world.organization.dropHeldReply(world.juan.caller, { handoffId: held!.id }));

    expect(await openHandoffs(world.juan.caller)).toMatchObject([
      { id: held!.id, heldReply: null },
    ]);
    expect(await auditEntriesFor(world.organization, held!.id)).toMatchObject([
      { entityType: "handoff", before: { heldReply: "held" }, after: { heldReply: null } },
    ]);
  });

  it("is dropped by anyone who reads the conversation, and by no one else", async () => {
    const [held] = await openHandoffs(world.juan.caller);
    const data = { handoffId: held!.id };
    await bookMartinaWithLucia();

    expect(await world.organization.dropHeldReply(world.lucia.caller, data)).toEqual({
      ok: false,
      reason: "notFound",
    });
    const mustChange = await addRefusedAdmin(world.organization, "mustChangePassword");
    expect(await world.organization.dropHeldReply(mustChange, data)).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    const deactivated = await addRefusedAdmin(world.organization, "deactivated");
    expect(await world.organization.dropHeldReply(deactivated, data)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(await openHandoffs(world.juan.caller)).toMatchObject([{ heldReply: clinicalReply }]);

    expectOk(await world.organization.dropHeldReply(world.receptionist, data));

    expect(await openHandoffs(world.juan.caller)).toMatchObject([{ heldReply: null }]);
  });
});

describe("an emergency", () => {
  /** What the patient is told, as `vos`, with the organization's phone. */
  const emergencyText =
    "Si es una urgencia, llamá ahora al 107 (emergencias). También podés llamarnos al 0351 15-555-1234. Ya le pasamos tu mensaje a una persona del equipo.";

  function judgedAnEmergency() {
    scriptedModel.script((one) => {
      one.call("judge_messages", { needsPractitioner: true, emergency: true });
      return "Respirá hondo, seguro no es nada.";
    });
  }

  beforeEach(async () => {
    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        formOfAddress: "vos",
        tone: "",
        phone: "0351 15 555-1234",
      }),
    );
  });

  it("gets the fixed reply with the organization's phone and the emergency number, and a clinical handoff", async () => {
    await writes("me desmayé y me duele mucho el pecho");
    judgedAnEmergency();
    await turn();

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: emergencyText }]);
    expect(scriptedModel.checks).toEqual([]);
    expect(await openHandoffs(world.juan.caller)).toMatchObject([
      { reason: "emergency", forPractitioner: true },
    ]);
  });

  it("names only the emergency number while the organization has no phone", async () => {
    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        formOfAddress: "usted",
        tone: "",
        phone: "",
      }),
    );
    await writes("me desmayé");
    judgedAnEmergency();
    await turn();

    expect(fakeMeta.textsSent()).toEqual([
      {
        to: "5491155550000",
        text: "Si es una urgencia, llame ahora al 107 (emergencias). Ya le pasamos su mensaje a una persona del equipo.",
      },
    ]);
  });

  it("gets the fixed reply though a handoff is already open", async () => {
    await writes("quiero hablar con alguien");
    scriptedModel.script((one) => {
      one.call("judge_messages", notClinical);
      one.call("hand_off", { reason: "patient_asked" });
      return "";
    });
    await turn();
    await writes("me desmayé");
    judgedAnEmergency();
    await turn();

    expect(fakeMeta.textsSent()).toEqual([{ to: "5491155550000", text: emergencyText }]);
  });
});

describe("a photo or a file from the patient", () => {
  it("never reaches the model, goes to reception, and tells the patient nothing", async () => {
    await patientSends(world.organization, "image", martinaPhone);
    await turn();

    expect(scriptedModel.turns).toEqual([]);
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs(adminCaller)).toMatchObject([
      { reason: "media", forPractitioner: false, media: ["image"] },
    ]);
    const read = await conversationOf(world.receptionist);
    expect(read.messages.filter((one) => one.direction === "incoming")).toMatchObject([
      { type: "image", judgement: "notForPractitioner" },
    ]);
  });

  it("names every kind the patient sent while its handoff is open", async () => {
    await patientSends(world.organization, "image", martinaPhone);
    await turn();
    await patientSends(world.organization, "document", martinaPhone);
    await turn();

    expect(await openHandoffs(adminCaller)).toMatchObject([
      { reason: "media", media: ["image", "document"] },
    ]);
  });

  it("is kept from the model when the patient writes beside it, and goes to reception with it", async () => {
    await writes("te mando el comprobante");
    await patientSends(world.organization, "document", martinaPhone);
    await turn();

    const judged = scriptedModel.turns[0]!.messages.at(-1)!.content;
    expect(judged).toContain("te mando el comprobante");
    expect(judged).not.toContain("document");
    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs(adminCaller)).toMatchObject([
      { reason: "media", forPractitioner: false },
    ]);
    const read = await conversationOf(world.receptionist);
    expect(read.messages.filter((one) => one.direction === "incoming")).toMatchObject([
      { text: "te mando el comprobante" },
      { type: "document" },
    ]);
  });

  it("is handed off while the text beside it, which the model could not read, gets no reply", async () => {
    await writes("te mando el estudio");
    await patientSends(world.organization, "document", martinaPhone);
    scriptedModel.script(() => {
      throw new Error("The model is overloaded");
    });
    await turn();

    expect(fakeMeta.textsSent()).toEqual([]);
    expect(await openHandoffs(adminCaller)).toMatchObject([
      { reason: "media", forPractitioner: false },
    ]);
  });
});
