import { runDurableObjectAlarm } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { metaTemplateName } from "#/lib/whatsapp-templates.ts";
import {
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  metaAccessToken,
  metaPhoneNumberId,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import { conversation, outboxMessage, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// Sending what the outbox holds: the messages of the organization's own
// templates, here the booking confirmation every organization starts with a
// draft of. When each is queued is `template-messages.workers.test.ts`'s.

// The object reaches Meta only through its Graph API client, whose HTTP calls
// go to the fake Meta: each test reads the requests it received.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const confirmationBody =
  "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba";

/** Meta's answer to a template message it accepted, for the number `waId`. */
function metaSent(messageId: string, waId = "5491155550000") {
  return {
    messaging_product: "whatsapp",
    contacts: [{ input: waId, wa_id: waId }],
    messages: [{ id: messageId }],
  };
}

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
/** The organization's draft `Confirmación del turno`, which the medical service sends. */
let confirmationId: string;

/**
 * Submits the booking confirmation as the admin, and has Meta answer `status`
 * at once; `body` differs from the latest version's, or the save sends nothing.
 */
function submitConfirmation(
  status: "APPROVED" | "PENDING",
  metaId = "900000000000001",
  body = confirmationBody,
) {
  return submitTemplate(world.organization, confirmationId, { status, metaId, body });
}

/** The messages the object sent Meta: its `POST`s to the number's `/messages`. */
function sentToMeta() {
  return fakeMeta.requests.filter((request) => request.url.endsWith("/messages"));
}

function outbox() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        kind: outboxMessage.kind,
        templateId: outboxMessage.templateId,
        appointmentId: outboxMessage.appointmentId,
        dueAt: outboxMessage.dueAt,
        state: outboxMessage.state,
        attempts: outboxMessage.attempts,
        dropReason: outboxMessage.dropReason,
        errorCode: outboxMessage.errorCode,
        errorMessage: outboxMessage.errorMessage,
        whatsappMessageId: outboxMessage.whatsappMessageId,
      })
      .from(outboxMessage)
      .all(),
  );
}

/** Every stored WhatsApp message, oldest first, with its conversation's number. */
function storedMessages() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        id: whatsappMessage.id,
        whatsappId: whatsappMessage.whatsappId,
        direction: whatsappMessage.direction,
        text: whatsappMessage.text,
        phone: conversation.phone,
        conversationId: conversation.id,
      })
      .from(whatsappMessage)
      .innerJoin(conversation, eq(conversation.id, whatsappMessage.conversationId))
      .orderBy(sql`${whatsappMessage}.rowid`)
      .all(),
  );
}

/** Moves the object's clock past every retry's wait. */
function laterOn() {
  vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
}

/** Books Martina, at 09:00 in Buenos Aires on the first Monday, for the medical service. */
async function bookMartina(phone = "+5491155550000") {
  const patient = await world.addPatient("Martina", phone);
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start: at("12:00"),
    durationMinutes: 30,
  });
  return { patient, appointmentId: booked.id };
}

beforeEach(async () => {
  // The object's clock, a month before the appointments: what it queues is
  // due then, still in the future for the runtime's own alarm scheduler, so
  // the alarm fires only when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  confirmationId = await templateNamed(world.organization, "Confirmación del turno");
  await world.pickTemplates(medicalServiceId, [confirmationId]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("queueing the booking confirmation", () => {
  beforeEach(async () => {
    await submitConfirmation("APPROVED");
  });

  it("queues one message, as its template, when the medical service sends it", async () => {
    const { appointmentId } = await bookMartina();

    expect(await outbox()).toEqual([
      expect.objectContaining({
        kind: "timed",
        templateId: confirmationId,
        appointmentId,
        state: "queued",
      }),
    ]);
  });

  it("queues one for an overbooking too", async () => {
    const patient = await world.addPatient("Martina", "+5491155550000");
    const booked = await world.overbook({
      practitionerId: world.juan.practitionerId,
      patientId: patient.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    });

    expect(await outbox()).toEqual([expect.objectContaining({ appointmentId: booked.id })]);
  });

  it("queues none when the medical service does not send it", async () => {
    await world.pickTemplates(medicalServiceId, []);

    await bookMartina();

    expect(await outbox()).toEqual([]);
  });

  it("queues none for a patient without WhatsApp consent", async () => {
    const patient = await world.addPatient("Martina", "+5491155550000");
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: patient.id,
        whatsappConsent: false,
      }),
    );

    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: patient.id,
      medicalServiceId,
      start: at("12:00"),
      durationMinutes: 30,
    });

    expect(await outbox()).toEqual([]);
  });
});

describe("sending the booking confirmation", () => {
  it("sends the approved template, filled from the appointment, and stores Meta's message id in the patient's conversation", async () => {
    await submitConfirmation("APPROVED");
    fakeMeta.answerWith(200, metaSent("wamid.confirmation"));
    await bookMartina();

    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([
      {
        method: "POST",
        url: `https://graph.facebook.com/v26.0/${metaPhoneNumberId}/messages`,
        authorization: `Bearer ${metaAccessToken}`,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5491155550000",
          type: "template",
          template: {
            name: metaTemplateName(confirmationId, 1),
            language: { code: "es_AR" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", parameter_name: "paciente", text: "Martina" },
                  { type: "text", parameter_name: "profesional", text: "Juan Gómez" },
                  { type: "text", parameter_name: "fecha", text: "lunes 5 de enero" },
                  { type: "text", parameter_name: "hora", text: "09:00" },
                  { type: "text", parameter_name: "sede", text: "Sede Centro" },
                  { type: "text", parameter_name: "direccion", text: "Av. Colón 100" },
                ],
              },
            ],
          },
        },
      },
    ]);
    const [stored] = await storedMessages();
    expect(stored).toMatchObject({
      whatsappId: "wamid.confirmation",
      direction: "outgoing",
      phone: "+5491155550000",
      text: "Hola Martina, tu turno con Juan Gómez quedó reservado para el lunes 5 de enero a las 09:00 en Sede Centro (Av. Colón 100). Consultorios Prueba",
    });
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "sent", attempts: 1, whatsappMessageId: stored!.id }),
    ]);
  });

  it("sends the latest approved version", async () => {
    await submitConfirmation("APPROVED", "900000000000001");
    await submitConfirmation("APPROVED", "900000000000002", `${confirmationBody}.`);
    await submitConfirmation("PENDING", "900000000000003", `${confirmationBody}!`);
    await bookMartina();

    await runDurableObjectAlarm(world.organization);

    expect(
      sentToMeta().map((request) => (request.body as { template: { name: string } }).template.name),
    ).toEqual([metaTemplateName(confirmationId, 2)]);
  });

  it("sends it to the guardian who is the patient's message contact", async () => {
    await submitConfirmation("APPROVED");
    fakeMeta.answerWith(200, metaSent("wamid.confirmation", "5493515550000"));
    const { patient } = await bookMartina();
    const { guardian } = expectOk(
      await world.organization.addGuardian(adminCaller, {
        patientId: patient.id,
        name: "Laura Paz",
        relationship: "Madre",
        phone: "+5493515550000",
      }),
    );
    expectOk(
      await world.organization.setMessageContact(adminCaller, {
        patientId: patient.id,
        guardianId: guardian.id,
      }),
    );

    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta().map((request) => (request.body as { to: string }).to)).toEqual([
      "5493515550000",
    ]);
    expect(await storedMessages()).toEqual([expect.objectContaining({ phone: "+5493515550000" })]);
  });

  it("puts the patient's reply in the same conversation as the confirmation", async () => {
    await submitConfirmation("APPROVED");
    // The patient was registered without the mobile `9`; WhatsApp answers with it.
    fakeMeta.answerWith(200, metaSent("wamid.confirmation", "5491155550000"));
    await bookMartina("+541155550000");
    await runDurableObjectAlarm(world.organization);

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [
          {
            whatsappId: "wamid.reply",
            from: "+5491155550000",
            sentAt: Date.now(),
            type: "text",
            text: "Gracias!",
            payload: "{}",
          },
        ],
        statuses: [],
        templateStatuses: [],
      }),
    );

    const [confirmation, reply] = await storedMessages();
    expect(reply).toMatchObject({ whatsappId: "wamid.reply", direction: "incoming" });
    expect(reply!.conversationId).toBe(confirmation!.conversationId);
  });

  it("keeps a status Meta reports while the send's answer is still on its way", async () => {
    await submitConfirmation("APPROVED");
    fakeMeta.answerWith(200, metaSent("wamid.confirmation"));
    await bookMartina();
    const release = fakeMeta.holdNext();
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [{ whatsappId: "wamid.confirmation", status: "delivered", at: Date.now() }],
        templateStatuses: [],
      }),
    );
    release();
    await alarm;

    const statuses = await inStorage(world.organization, (database) =>
      database.select({ status: whatsappMessage.status }).from(whatsappMessage).all(),
    );
    expect(statuses).toEqual([{ status: "delivered" }]);
  });

  it("sends nothing for an appointment cancelled before the alarm fires", async () => {
    await submitConfirmation("APPROVED");
    const { appointmentId } = await bookMartina();
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "patient",
      }),
    );

    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "appointmentChanged" }),
    ]);
  });

  it("sends nothing to a patient whose consent was withdrawn after the booking", async () => {
    await submitConfirmation("APPROVED");
    const { patient } = await bookMartina();
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: patient.id,
        whatsappConsent: false,
      }),
    );

    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noConsent" }),
    ]);
  });

  it("waits while Meta pauses its only approved version, and sends once Meta approves it again", async () => {
    await submitConfirmation("APPROVED", "900000000000001");
    await bookMartina();
    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [],
        templateStatuses: [{ metaId: "900000000000001", status: "paused", reason: null }],
      }),
    );

    await runDurableObjectAlarm(world.organization);
    expect(sentToMeta()).toEqual([]);
    expect(await outbox()).toEqual([expect.objectContaining({ state: "queued", attempts: 0 })]);

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [],
        templateStatuses: [{ metaId: "900000000000001", status: "approved", reason: null }],
      }),
    );
    expect(await runDurableObjectAlarm(world.organization)).toBe(true);

    expect(sentToMeta()).toHaveLength(1);
    expect(await outbox()).toEqual([expect.objectContaining({ state: "sent" })]);
  });

  it("retries a send Meta refuses, and stores the failure after the last attempt", async () => {
    await submitConfirmation("APPROVED");
    fakeMeta.answerWith(400, { error: { code: 131026, message: "Message undeliverable" } });
    await bookMartina();

    await runDurableObjectAlarm(world.organization);
    expect(await outbox()).toEqual([expect.objectContaining({ state: "queued", attempts: 1 })]);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      laterOn();
      await runDurableObjectAlarm(world.organization);
    }

    expect(sentToMeta()).toHaveLength(5);
    expect(await outbox()).toEqual([
      expect.objectContaining({
        state: "failed",
        attempts: 5,
        errorCode: 131026,
        errorMessage: "Message undeliverable",
      }),
    ]);
    expect(await storedMessages()).toEqual([]);
  });

  it("sends a retried message once Meta accepts it", async () => {
    await submitConfirmation("APPROVED");
    fakeMeta.answerNextWith(500, { error: { code: 1, message: "Temporary" } });
    fakeMeta.answerWith(200, metaSent("wamid.confirmation"));
    await bookMartina();

    await runDurableObjectAlarm(world.organization);
    laterOn();
    await runDurableObjectAlarm(world.organization);

    expect(await outbox()).toEqual([expect.objectContaining({ state: "sent", attempts: 2 })]);
  });
});
