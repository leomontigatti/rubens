import { runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MessageJudgement } from "#/lib/whatsapp-messages.ts";

import {
  addRefusedAdmin,
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import { handoff, handoffRecipient, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The inbox's reading rules (docs/domain/assistant.md § Inbox): reception
// and admins read every conversation, every message in it; a practitioner
// only the conversations handed to them.

// The booking confirmation reaches Meta through the Graph API client, whose
// HTTP calls go to the fake Meta.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const martinaPhone = "+5491155550000";
const symptoms = "Me duele mucho la muela desde ayer";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let martinaId: string;
let medicalServiceId: string;

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

/** Judges a stored message as the assistant's turn does (`assistant.ts`), without running one. */
function judge(whatsappId: string, judgement: MessageJudgement) {
  return inStorage(world.organization, (database) =>
    database
      .update(whatsappMessage)
      .set({ judgement })
      .where(eq(whatsappMessage.whatsappId, whatsappId))
      .run(),
  );
}

/** Hands the one conversation to `caller`, as an open handoff the assistant opened. */
async function handedTo(caller: { userId: string }) {
  const [conversation] = expectOk(
    await world.organization.listConversations(world.receptionist, {}),
  ).conversations;
  await inStorage(world.organization, (database) => {
    const opened = database
      .insert(handoff)
      .values({ conversationId: conversation!.id, reason: "clinical", forPractitioner: true })
      .returning({ id: handoff.id })
      .get();
    database
      .insert(handoffRecipient)
      .values({ handoffId: opened.id, memberId: caller.userId })
      .run();
  });
}

/** The one conversation `caller` lists, read in full. */
async function readOnlyConversation(caller: { userId: string }) {
  const listed = expectOk(await world.organization.listConversations(caller, {}));
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
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  martinaId = (await world.addPatient("Martina", martinaPhone)).id;
  // The booking confirmation, approved and sent by the medical service, queued by the booking.
  const confirmationId = await templateNamed(world.organization, "Confirmación del turno");
  await submitTemplate(world.organization, confirmationId, {
    status: "APPROVED",
    metaId: "900000000000001",
    body: "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba",
  });
  await world.pickTemplates(medicalServiceId, [confirmationId]);
  await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: martinaId,
    medicalServiceId,
    start: at("12:00"),
    durationMinutes: 30,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reading a conversation in the inbox", () => {
  it("shows reception a message the assistant has not judged yet, with its words", async () => {
    await patientWrites(symptoms);

    const read = await readOnlyConversation(world.receptionist);

    expect(read.conversation).toMatchObject({
      phone: martinaPhone,
      patients: [{ id: martinaId, name: "Martina Paz" }],
    });
    expect(read.messages).toEqual([
      expect.objectContaining({ direction: "incoming", text: symptoms, judgement: null }),
    ]);
  });

  it("shows reception a message judged for the practitioner, with its words", async () => {
    await patientWrites(symptoms).then((id) => judge(id, "forPractitioner"));
    await patientWrites("Gracias, ahí estaré").then((id) => judge(id, "notForPractitioner"));

    const read = await readOnlyConversation(world.receptionist);

    expect(read.messages).toEqual([
      expect.objectContaining({ text: symptoms, judgement: "forPractitioner" }),
      expect.objectContaining({ text: "Gracias, ahí estaré", judgement: "notForPractitioner" }),
    ]);
  });

  it("lets a practitioner read a conversation handed to them, every message included", async () => {
    await patientWrites("Gracias, ahí estaré");
    await patientWrites(symptoms).then((id) => judge(id, "forPractitioner"));
    await handedTo(world.juan.caller);

    const read = await readOnlyConversation(world.juan.caller);

    expect(read.messages).toEqual([
      expect.objectContaining({ text: "Gracias, ahí estaré", judgement: null }),
      expect.objectContaining({ text: symptoms, judgement: "forPractitioner" }),
    ]);
  });

  it("refuses a practitioner the conversation of their own patient when it was not handed to them", async () => {
    await patientWrites(symptoms);
    const [conversation] = expectOk(
      await world.organization.listConversations(world.receptionist, {}),
    ).conversations;

    const listed = expectOk(await world.organization.listConversations(world.juan.caller, {}));
    const opened = await world.organization.readConversation(world.juan.caller, {
      conversationId: conversation!.id,
    });

    // Juan has Martina's appointment, but nothing of her conversation was handed to him.
    expect(listed.conversations).toEqual([]);
    expect(opened).toEqual({ ok: false, reason: "notFound" });
  });

  it("refuses a practitioner a conversation handed to someone else", async () => {
    await patientWrites(symptoms);
    await handedTo(world.juan.caller);

    const listed = expectOk(await world.organization.listConversations(world.lucia.caller, {}));

    expect(listed.conversations).toEqual([]);
  });

  it("gives an admin who is not a practitioner the receptionist's view", async () => {
    await patientWrites(symptoms);

    const asAdmin = await readOnlyConversation(adminCaller);
    const asReception = await readOnlyConversation(world.receptionist);

    expect(asAdmin).toEqual(asReception);
  });

  it("lists conversations latest first, each with its latest message", async () => {
    await patientWrites(symptoms);
    await world.addPatient("Bruno", "+5491155550001");
    await patientWrites(symptoms, "+5491155550001");
    await patientWrites("Gracias, ahí estaré").then((id) => judge(id, "notForPractitioner"));

    const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));

    expect(listed.conversations).toEqual([
      expect.objectContaining({
        phone: martinaPhone,
        lastMessage: expect.objectContaining({ text: "Gracias, ahí estaré" }),
      }),
      expect.objectContaining({
        phone: "+5491155550001",
        lastMessage: expect.objectContaining({ text: symptoms }),
      }),
    ]);
  });

  it("shows the booking confirmation's text and delivery to reception before the patient answers, and not to its practitioner", async () => {
    await runDurableObjectAlarm(world.organization);
    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [{ whatsappId: "wamid.test-message", status: "delivered", at: Date.now() }],
        templateStatuses: [],
      }),
    );

    const read = await readOnlyConversation(world.receptionist);
    const asJuan = expectOk(await world.organization.listConversations(world.juan.caller, {}));

    expect(read.conversation.patients).toEqual([]);
    expect(read.messages).toEqual([
      expect.objectContaining({
        direction: "outgoing",
        type: "template",
        text: expect.stringContaining("Hola Martina, tu turno con Juan Gómez"),
        status: "delivered",
      }),
    ]);
    expect(asJuan.conversations).toEqual([]);
  });

  it("finds conversations by a patient's name or by the number, a page at a time", async () => {
    await patientWrites("Hola");
    await world.addPatient("Bruno", "+5491155550001");
    await patientWrites("Hola", "+5491155550001");
    await patientWrites("Hola", "+5491155559999");
    const search = async (query: string) =>
      expectOk(
        await world.organization.listConversations(world.receptionist, { query }),
      ).conversations.map((conversation) => conversation.phone);

    expect(await search("martina paz")).toEqual([martinaPhone]);
    expect(await search("011 15 5555-9999")).toEqual(["+5491155559999"]);
    expect(await search("5555000")).toEqual(
      expect.arrayContaining([martinaPhone, "+5491155550001"]),
    );
    expect(await search("lucía")).toEqual([]);
    expect(await search("+")).toEqual([]);
    expect(await search("a ".repeat(100))).toEqual(expect.arrayContaining([martinaPhone]));
  });

  it("pages the list, 25 conversations at a time", async () => {
    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: Array.from({ length: 26 }, (_, index) => ({
          whatsappId: `wamid.page-${index}`,
          from: `+54911555600${String(index).padStart(2, "0")}`,
          sentAt: Date.UTC(2099, 0, 5, 12, index),
          type: "text",
          text: "Hola",
          payload: "{}",
        })),
        statuses: [],
        templateStatuses: [],
      }),
    );

    const second = expectOk(
      await world.organization.listConversations(world.receptionist, { page: 2 }),
    );

    expect(second).toMatchObject({ total: 26, page: 2 });
    expect(second.conversations.map((conversation) => conversation.phone)).toEqual([
      "+5491155560000",
    ]);
  });

  it("is refused to anyone signed out, deactivated or still holding the starting password", async () => {
    await patientWrites(symptoms);
    const [conversation] = expectOk(
      await world.organization.listConversations(world.receptionist, {}),
    ).conversations;
    const callers = [
      { userId: "user-stranger" },
      await addRefusedAdmin(world.organization, "deactivated"),
      await addRefusedAdmin(world.organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.flatMap((caller) => [
        world.organization.listConversations(caller, {}),
        world.organization.readConversation(caller, { conversationId: conversation!.id }),
      ]),
    );

    expect(answers.map((answer) => (answer.ok ? "done" : answer.reason))).toEqual([
      ...["unauthenticated", "unauthenticated"],
      ...["unauthenticated", "unauthenticated"],
      ...["mustChangePassword", "mustChangePassword"],
    ]);
  });
});

describe("the patients a conversation's number stands for", () => {
  const unknownPhone = "+5491155559999";

  /** Books `patientId` with Juan at `time`, as reception; nothing is sent while no template is approved. */
  function bookWithJuan(patientId: string, time: string) {
    return world.book({
      practitionerId: world.juan.practitionerId,
      patientId,
      medicalServiceId,
      start: at(time),
      durationMinutes: 30,
    });
  }

  it("links a number's conversation to its patient once registered, before they write again", async () => {
    await patientWrites("Hola, ¿atienden con obra social?", unknownPhone);
    const bruno = await world.addPatient("Bruno", unknownPhone);
    await bookWithJuan(bruno.id, "13:00");

    const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));

    expect(listed.conversations).toEqual([
      expect.objectContaining({
        phone: unknownPhone,
        patients: [{ id: bruno.id, name: "Bruno Paz" }],
      }),
    ]);
  });

  it("moves the link with the patient's number, so the old number's conversation stands for nobody", async () => {
    const newPhone = "+5491155558888";
    await patientWrites(symptoms);
    await patientWrites("Hola", newPhone);
    const [atOldNumber] = expectOk(
      await world.organization.listConversations(world.receptionist, { query: martinaPhone }),
    ).conversations;

    expectOk(
      await world.organization.updatePatient(world.receptionist, {
        patientId: martinaId,
        firstName: "Martina",
        lastName: "Paz",
        phone: newPhone,
      }),
    );

    const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));
    expect(listed.conversations).toEqual([
      expect.objectContaining({
        phone: newPhone,
        patients: [{ id: martinaId, name: "Martina Paz" }],
      }),
      expect.objectContaining({ id: atOldNumber!.id, patients: [] }),
    ]);
  });

  it("follows the patient's message contact to a guardian's number and back", async () => {
    const guardianPhone = "+5491155557777";
    await patientWrites("Hola");
    await patientWrites("Hola, soy la mamá", guardianPhone);
    const added = expectOk(
      await world.organization.addGuardian(world.receptionist, {
        patientId: martinaId,
        name: "Laura Paz",
        relationship: "Madre",
        phone: guardianPhone,
      }),
    ).guardian;
    const linkedPhones = async () =>
      expectOk(await world.organization.listConversations(world.receptionist, {}))
        .conversations.filter((conversation) => conversation.patients.length > 0)
        .map((conversation) => [conversation.phone, conversation.patients.map(({ id }) => id)]);

    expectOk(
      await world.organization.setMessageContact(world.receptionist, {
        patientId: martinaId,
        guardianId: added.id,
      }),
    );
    const throughGuardian = await linkedPhones();
    expectOk(await world.organization.removeGuardian(world.receptionist, { guardianId: added.id }));
    const backToPatient = await linkedPhones();

    expect(throughGuardian).toEqual([[guardianPhone, [martinaId]]]);
    expect(backToPatient).toEqual([[martinaPhone, [martinaId]]]);
  });

  it("moves the link with the contact guardian's number when it is edited", async () => {
    const [oldPhone, newPhone] = ["+5491155557777", "+5491155556666"];
    await patientWrites("Hola, soy la mamá", oldPhone);
    await patientWrites("Hola, soy la mamá, desde mi número nuevo", newPhone);
    const laura = { name: "Laura Paz", relationship: "Madre" };
    const added = expectOk(
      await world.organization.addGuardian(world.receptionist, {
        ...laura,
        patientId: martinaId,
        phone: oldPhone,
      }),
    ).guardian;
    expectOk(
      await world.organization.setMessageContact(world.receptionist, {
        patientId: martinaId,
        guardianId: added.id,
      }),
    );

    expectOk(
      await world.organization.updateGuardian(world.receptionist, {
        ...laura,
        guardianId: added.id,
        phone: newPhone,
      }),
    );

    const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));
    const linked = listed.conversations.filter((conversation) => conversation.patients.length > 0);
    expect(linked.map((conversation) => conversation.phone)).toEqual([newPhone]);
  });
});
