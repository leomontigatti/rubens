import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MessageJudgement } from "#/lib/whatsapp-messages.ts";

import {
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { practitioner, whatsappMessage } from "#/organization/schema.ts";

// The inbox's reading rules (docs/domain/assistant.md § Inbox): who reads
// which conversations, and which messages they read the words of.

// The booking confirmation reaches Meta through the Graph API client, whose
// HTTP calls go to the fake Meta.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: () => actual.whatsappCloudFor(fakeMeta.settings, fakeMeta.fetch),
  };
});

const martinaPhone = "+5491155550000";
const symptoms = "Me duele mucho la muela desde ayer";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let martinaId: string;

let minutesIn = 0;

/** A text from `from`, a minute after the last, stored as Meta's webhook hands it over; returns its WhatsApp id. */
async function patientWrites(text: string, from = martinaPhone) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  minutesIn += 1;
  const sentAt = Date.UTC(2099, 0, 5, 12, minutesIn);
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [{ whatsappId, from, sentAt, type: "text", text, payload: "{}" }],
      statuses: [],
      templateStatuses: [],
    }),
  );
  return whatsappId;
}

/** Judges a stored message as the assistant will (#169): no method judges yet. */
function judge(whatsappId: string, judgement: MessageJudgement) {
  return inStorage(world.organization, (database) =>
    database
      .update(whatsappMessage)
      .set({ judgement })
      .where(eq(whatsappMessage.whatsappId, whatsappId))
      .run(),
  );
}

/** The one conversation `caller` lists, read in full. */
async function readOnlyConversation(caller: { userId: string }) {
  const listed = expectOk(await world.organization.listConversations(caller));
  expect(listed.conversations).toHaveLength(1);
  return expectOk(
    await world.organization.readConversation(caller, {
      conversationId: listed.conversations[0]!.id,
    }),
  );
}

beforeEach(async () => {
  // The object's clock, a month before the appointment: the confirmation it
  // queues stays in the runtime scheduler's future, so the alarm fires only
  // when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  const medicalService = await world.addMedicalService(world.juan.practitionerId);
  martinaId = (await world.addPatient("Martina", martinaPhone)).id;
  await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: martinaId,
    medicalServiceId: medicalService.id,
    start: at("12:00"),
    durationMinutes: 30,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reading a conversation in the inbox", () => {
  it("shows reception that a message waits to be read, never its words, until it is judged", async () => {
    await patientWrites(symptoms);

    const read = await readOnlyConversation(world.receptionist);

    expect(read.conversation).toMatchObject({
      phone: martinaPhone,
      patients: [{ id: martinaId, name: "Martina Paz" }],
    });
    expect(read.messages).toEqual([
      expect.objectContaining({ direction: "incoming", withheld: "notJudged" }),
    ]);
    expect(JSON.stringify(read)).not.toContain(symptoms);
  });

  it("shows reception a message judged not clinical, and only that a clinical one exists", async () => {
    await patientWrites(symptoms).then((id) => judge(id, "clinical"));
    await patientWrites("Gracias, ahí estaré").then((id) => judge(id, "notClinical"));

    const read = await readOnlyConversation(world.receptionist);

    expect(read.messages).toEqual([
      expect.objectContaining({ withheld: "clinical" }),
      expect.objectContaining({ withheld: null, text: "Gracias, ahí estaré" }),
    ]);
    expect(JSON.stringify(read)).not.toContain(symptoms);
  });

  it("lets a practitioner who keeps clinical records read every message about their own appointment", async () => {
    await patientWrites("Gracias, ahí estaré");
    await patientWrites(symptoms).then((id) => judge(id, "clinical"));

    const read = await readOnlyConversation(world.juan.caller);

    expect(read.messages).toEqual([
      expect.objectContaining({ withheld: null, text: "Gracias, ahí estaré", judgement: null }),
      expect.objectContaining({ withheld: null, text: symptoms, judgement: "clinical" }),
    ]);
  });

  it("withholds unjudged messages from a practitioner who keeps no clinical records", async () => {
    await inStorage(world.organization, (database) =>
      database
        .update(practitioner)
        .set({ keepsClinicalRecords: false })
        .where(eq(practitioner.id, world.juan.practitionerId))
        .run(),
    );
    await patientWrites(symptoms);

    const read = await readOnlyConversation(world.juan.caller);

    expect(read.messages).toEqual([expect.objectContaining({ withheld: "notJudged" })]);
    expect(JSON.stringify(read)).not.toContain(symptoms);
  });

  it("refuses a practitioner a conversation about another practitioner's appointments", async () => {
    await patientWrites(symptoms);
    const [conversation] = expectOk(
      await world.organization.listConversations(world.receptionist),
    ).conversations;

    const listed = expectOk(await world.organization.listConversations(world.lucia.caller));
    const opened = await world.organization.readConversation(world.lucia.caller, {
      conversationId: conversation!.id,
    });

    expect(listed.conversations).toEqual([]);
    expect(opened).toEqual({ ok: false, reason: "notFound" });
  });

  it("gives an admin who is not a practitioner the receptionist's view", async () => {
    await patientWrites(symptoms);

    const asAdmin = await readOnlyConversation(adminCaller);
    const asReception = await readOnlyConversation(world.receptionist);

    expect(asAdmin).toEqual(asReception);
    expect(JSON.stringify(asAdmin)).not.toContain(symptoms);
  });

  it("lists conversations latest first, each with its latest message read by the same rule", async () => {
    await patientWrites(symptoms);
    await world.addPatient("Bruno", "+5491155550001");
    await patientWrites(symptoms, "+5491155550001");
    await patientWrites("Gracias, ahí estaré").then((id) => judge(id, "notClinical"));

    const listed = expectOk(await world.organization.listConversations(world.receptionist));

    expect(listed.conversations).toEqual([
      expect.objectContaining({
        phone: martinaPhone,
        lastMessage: expect.objectContaining({ withheld: null, text: "Gracias, ahí estaré" }),
      }),
      expect.objectContaining({
        phone: "+5491155550001",
        lastMessage: expect.objectContaining({ withheld: "notJudged" }),
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(symptoms);
  });

  it("shows the booking confirmation's text and delivery to its practitioner before the patient answers", async () => {
    fakeMeta.answerNextWith(200, {
      id: "900000000000001",
      status: "APPROVED",
      category: "UTILITY",
    });
    expectOk(
      await world.organization.submitWhatsappTemplate(adminCaller, {
        templateName: "confirmacion_turno",
        body: "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba",
      }),
    );
    await runDurableObjectAlarm(world.organization);
    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [{ whatsappId: "wamid.test-message", status: "delivered", at: Date.now() }],
        templateStatuses: [],
      }),
    );

    const read = await readOnlyConversation(world.juan.caller);
    const elsewhere = expectOk(await world.organization.listConversations(world.lucia.caller));

    expect(read.conversation.patients).toEqual([]);
    expect(read.messages).toEqual([
      expect.objectContaining({
        direction: "outgoing",
        type: "template",
        text: expect.stringContaining("Hola Martina, tu turno con Juan Gómez"),
        status: "delivered",
      }),
    ]);
    expect(elsewhere.conversations).toEqual([]);
  });
});
