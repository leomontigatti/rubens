import { runDurableObjectAlarm } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  at,
  expectOk,
  fakeMeta,
  inStorage,
  metaAccessToken,
  metaPhoneNumberId,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { conversation, outboxMessage, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";

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

const reminderBody =
  "Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. ¿Nos confirmás tu asistencia? Consultorios Prueba";

const reminderWithoutConfirmationBody =
  "Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{sede}} ({{direccion}}). Consultorios Prueba";

/** Submits `templateName` as the admin, and has Meta answer `status` at once. */
async function submitTemplate(
  templateName: TemplateName,
  body: string,
  status: "APPROVED" | "PENDING",
  metaId: string,
) {
  fakeMeta.answerNextWith(200, { id: metaId, status, category: "UTILITY" });
  expectOk(await world.organization.submitWhatsappTemplate(adminCaller, { templateName, body }));
  fakeMeta.requests = [];
}

/** Submits `confirmacion_turno` as the admin, and has Meta answer `status` at once. */
function submitConfirmation(status: "APPROVED" | "PENDING", metaId = "900000000000001") {
  return submitTemplate("confirmacion_turno", confirmationBody, status, metaId);
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
        appointmentId: outboxMessage.appointmentId,
        hoursBefore: outboxMessage.hoursBefore,
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("queueing the booking confirmation", () => {
  it("queues one message when the medical service sends the confirmation", async () => {
    const { appointmentId } = await bookMartina();

    expect(await outbox()).toEqual([
      expect.objectContaining({ kind: "bookingConfirmation", appointmentId, state: "queued" }),
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
    expectOk(
      await world.organization.updateMedicalService(adminCaller, {
        medicalServiceId,
        name: "Consulta",
        durationMinutes: 30,
        bookingConfirmation: false,
        reminders: [],
        careInstructions: null,
        followUpHours: null,
        rescheduleCutoffHours: 24,
      }),
    );

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
            name: "confirmacion_turno_v1",
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
    await submitConfirmation("APPROVED", "900000000000002");
    await submitConfirmation("PENDING", "900000000000003");
    await bookMartina();

    await runDurableObjectAlarm(world.organization);

    expect(
      sentToMeta().map((request) => (request.body as { template: { name: string } }).template.name),
    ).toEqual(["confirmacion_turno_v2"]);
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

  it("waits while no version of the template is approved, and sends once one is", async () => {
    await submitConfirmation("PENDING", "900000000000001");
    await bookMartina();

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

const hours = (count: number) => count * 60 * 60_000;

/** The medical service's messages: none but those given. */
async function setMessages(
  messages: Partial<{
    reminders: { hoursBefore: number; asksToConfirm: boolean }[];
    careInstructions: string | null;
    followUpHours: number | null;
  }>,
) {
  expectOk(
    await world.organization.updateMedicalService(adminCaller, {
      medicalServiceId,
      name: "Consulta",
      durationMinutes: 30,
      bookingConfirmation: false,
      reminders: [],
      careInstructions: null,
      followUpHours: null,
      rescheduleCutoffHours: 24,
      ...messages,
    }),
  );
}

/** The medical service's reminders: hours before the appointment, and whether each asks to confirm. */
function setReminders(reminders: { hoursBefore: number; asksToConfirm: boolean }[]) {
  return setMessages({ reminders });
}

/** The queued reminders, latest first, as hours before the appointment and when each is due. */
async function queuedReminders() {
  return (await outbox())
    .filter((row) => row.state === "queued")
    .map(({ kind, hoursBefore, dueAt }) => ({ kind, hoursBefore, dueAt }))
    .sort((a, b) => b.hoursBefore! - a.hoursBefore!);
}

/** The template name of each message the object sent Meta, in order. */
function sentTemplates() {
  return sentToMeta().map(
    (request) => (request.body as { template: { name: string } }).template.name,
  );
}

const nineOnMonday = at("12:00");

describe("queueing reminders", () => {
  beforeEach(async () => {
    await setReminders([
      { hoursBefore: 48, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
  });

  it("queues one per reminder, each due its hours before the appointment", async () => {
    await bookMartina();

    expect(await queuedReminders()).toEqual([
      { kind: "reminder", hoursBefore: 48, dueAt: +nineOnMonday - hours(48) },
      { kind: "reminderWithoutConfirmation", hoursBefore: 2, dueAt: +nineOnMonday - hours(2) },
    ]);
  });

  it("skips a reminder whose time has passed at booking", async () => {
    vi.setSystemTime(+nineOnMonday - hours(24));

    await bookMartina();

    expect(await queuedReminders()).toEqual([expect.objectContaining({ hoursBefore: 2 })]);
  });

  it("keeps a reminder due at the very moment of booking", async () => {
    vi.setSystemTime(+nineOnMonday - hours(2));

    await bookMartina();

    expect(await queuedReminders()).toEqual([expect.objectContaining({ hoursBefore: 2 })]);
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
      start: nineOnMonday,
      durationMinutes: 30,
    });

    expect(await outbox()).toEqual([]);
  });

  it("replaces them with reminders for the new time when the appointment is moved", async () => {
    const { appointmentId } = await bookMartina();
    const nextMonday = at("12:00", "2099-01-12");

    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: nextMonday,
        durationMinutes: 30,
      }),
    );

    expect(await queuedReminders()).toEqual([
      { kind: "reminder", hoursBefore: 48, dueAt: +nextMonday - hours(48) },
      { kind: "reminderWithoutConfirmation", hoursBefore: 2, dueAt: +nextMonday - hours(2) },
    ]);
    expect(await outbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hoursBefore: 48,
          state: "dropped",
          dueAt: +nineOnMonday - hours(48),
        }),
      ]),
    );
  });

  it("leaves none to send once the appointment is cancelled", async () => {
    const { appointmentId } = await bookMartina();

    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "patient",
      }),
    );

    expect(await queuedReminders()).toEqual([]);
  });

  it("queues them again, less those already past, when the cancellation is undone", async () => {
    const { appointmentId } = await bookMartina();
    vi.setSystemTime(+nineOnMonday - hours(24));
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "patient",
      }),
    );

    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    expect(await queuedReminders()).toEqual([expect.objectContaining({ hoursBefore: 2 })]);
  });

  it("keeps them when the appointment is confirmed", async () => {
    const { appointmentId } = await bookMartina();

    expectOk(
      await world.organization.changeAppointmentStatus(adminCaller, {
        appointmentId,
        status: "confirmed",
      }),
    );

    expect(await queuedReminders()).toHaveLength(2);
  });
});

describe("sending reminders", () => {
  beforeEach(async () => {
    await submitTemplate("recordatorio_turno", reminderBody, "APPROVED", "900000000000011");
    await submitTemplate(
      "recordatorio_turno_sin_confirmacion",
      reminderWithoutConfirmationBody,
      "APPROVED",
      "900000000000012",
    );
    fakeMeta.answerWith(200, metaSent("wamid.reminder"));
  });

  it("sends a reminder that asks to confirm as `recordatorio_turno`, at its time", async () => {
    await setReminders([{ hoursBefore: 48, asksToConfirm: true }]);
    await bookMartina();

    vi.setSystemTime(+nineOnMonday - hours(49));
    await runDurableObjectAlarm(world.organization);
    expect(sentToMeta()).toEqual([]);

    vi.setSystemTime(+nineOnMonday - hours(48));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["recordatorio_turno_v1"]);
    const [stored] = await storedMessages();
    expect(stored!.text).toBe(
      "Hola Martina, te recordamos tu turno con Juan Gómez el lunes 5 de enero a las 09:00 en Sede Centro. ¿Nos confirmás tu asistencia? Consultorios Prueba",
    );
    expect(await outbox()).toEqual([expect.objectContaining({ state: "sent" })]);
  });

  it("sends one that does not ask to confirm as `recordatorio_turno_sin_confirmacion`", async () => {
    await setReminders([{ hoursBefore: 2, asksToConfirm: false }]);
    await bookMartina();

    vi.setSystemTime(+nineOnMonday - hours(2));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["recordatorio_turno_sin_confirmacion_v1"]);
  });

  it("sends only the later of two due reminders for one appointment", async () => {
    await setReminders([
      { hoursBefore: 48, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
    await bookMartina();

    vi.setSystemTime(+nineOnMonday - hours(1));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["recordatorio_turno_sin_confirmacion_v1"]);
    expect(await outbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hoursBefore: 48, state: "dropped", dropReason: "overtaken" }),
        expect.objectContaining({ hoursBefore: 2, state: "sent" }),
      ]),
    );
  });

  it("drops an earlier reminder still retrying once a later one has gone", async () => {
    await setReminders([
      { hoursBefore: 3, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
    await bookMartina();
    fakeMeta.answerWith(500, { error: { code: 1, message: "Temporary" } });
    // Four failures put the 3 h reminder's next try 2 h 36 min after its time.
    for (const minutes of [0, 1, 6, 36]) {
      vi.setSystemTime(+nineOnMonday - hours(3) + minutes * 60_000);
      await runDurableObjectAlarm(world.organization);
    }
    fakeMeta.answerWith(200, metaSent("wamid.reminder"));
    fakeMeta.requests = [];

    vi.setSystemTime(+nineOnMonday - hours(2));
    await runDurableObjectAlarm(world.organization);
    vi.setSystemTime(+nineOnMonday - 20 * 60_000);
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["recordatorio_turno_sin_confirmacion_v1"]);
    expect(await outbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hoursBefore: 3, state: "dropped", dropReason: "overtaken" }),
      ]),
    );
  });

  it("lets a reminder sent for the old time not stand for the new one after a move", async () => {
    await setReminders([{ hoursBefore: 2, asksToConfirm: false }]);
    const { appointmentId } = await bookMartina();
    vi.setSystemTime(+nineOnMonday - hours(2));
    await runDurableObjectAlarm(world.organization);
    await setReminders([{ hoursBefore: 48, asksToConfirm: true }]);
    const nextMonday = at("12:00", "2099-01-12");
    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: nextMonday,
        durationMinutes: 30,
      }),
    );
    fakeMeta.answerWith(200, metaSent("wamid.second"));

    vi.setSystemTime(+nextMonday - hours(1));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([
      "recordatorio_turno_sin_confirmacion_v1",
      "recordatorio_turno_v1",
    ]);
  });

  it("keeps the new time's reminders when the appointment moves while one is sending", async () => {
    await setReminders([
      { hoursBefore: 48, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
    const { appointmentId } = await bookMartina();
    vi.setSystemTime(+nineOnMonday - hours(2));
    const release = fakeMeta.holdNext();
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);
    const nextMonday = at("12:00", "2099-01-12");

    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: nextMonday,
        durationMinutes: 30,
      }),
    );
    release();
    await alarm;

    expect(await queuedReminders()).toEqual([
      expect.objectContaining({ hoursBefore: 48, dueAt: +nextMonday - hours(48) }),
      expect.objectContaining({ hoursBefore: 2, dueAt: +nextMonday - hours(2) }),
    ]);
  });

  it("sends an earlier reminder when the later one's template is paused during the batch", async () => {
    // Martina's 72 h reminder goes first in the batch; Lucas's two fall due behind it.
    await setReminders([{ hoursBefore: 72, asksToConfirm: true }]);
    const martina = await world.addPatient("Martina", "+5491155550000");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: martina.id,
      medicalServiceId,
      start: at("13:30"),
      durationMinutes: 30,
    });
    await setReminders([
      { hoursBefore: 48, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
    const lucas = await world.addPatient("Lucas", "+5491155550001");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: lucas.id,
      medicalServiceId,
      start: at("13:00"),
      durationMinutes: 30,
    });
    vi.setSystemTime(+at("13:00") - hours(1));
    fakeMeta.answerNextWith(200, metaSent("wamid.martina"));
    fakeMeta.answerNextWith(200, metaSent("wamid.lucas", "5491155550001"));
    const release = fakeMeta.holdNext();
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [],
        templateStatuses: [{ metaId: "900000000000012", status: "paused", reason: null }],
      }),
    );
    release();
    await alarm;

    expect(sentToMeta().map((request) => (request.body as { to: string }).to)).toEqual([
      "5491155550000",
      "5491155550001",
    ]);
  });

  it("sends nothing for an appointment cancelled before its reminder", async () => {
    await setReminders([{ hoursBefore: 2, asksToConfirm: false }]);
    const { appointmentId } = await bookMartina();
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "patient",
      }),
    );

    vi.setSystemTime(+nineOnMonday - hours(2));
    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
  });

  it("sends nothing to a patient whose consent was withdrawn after the booking", async () => {
    await setReminders([{ hoursBefore: 2, asksToConfirm: false }]);
    const { patient } = await bookMartina();
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: patient.id,
        whatsappConsent: false,
      }),
    );

    vi.setSystemTime(+nineOnMonday - hours(2));
    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noConsent" }),
    ]);
  });
});

describe("sending reminders while one template waits for approval", () => {
  it("sends an earlier reminder when the later one's template is not approved", async () => {
    await submitTemplate("recordatorio_turno", reminderBody, "APPROVED", "900000000000011");
    fakeMeta.answerWith(200, metaSent("wamid.reminder"));
    await setReminders([
      { hoursBefore: 48, asksToConfirm: true },
      { hoursBefore: 2, asksToConfirm: false },
    ]);
    await bookMartina();

    vi.setSystemTime(+nineOnMonday - hours(1));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["recordatorio_turno_v1"]);
  });
});

const careInstructionsBody =
  "Hola {{paciente}}, te dejamos las indicaciones de {{profesional}} para después de tu turno: {{indicaciones}}. Cualquier duda, respondé este mensaje. Consultorios Prueba";

const followUpBody =
  "Hola {{paciente}}, ¿cómo te sentís después de tu turno del {{fecha}} con {{profesional}}? Contanos respondiendo este mensaje. Consultorios Prueba";

/** Meta reports the template `metaId` moved to `status`. */
async function templateTurns(metaId: string, status: "approved" | "paused") {
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [],
      statuses: [],
      templateStatuses: [{ metaId, status, reason: null }],
    }),
  );
}

/** Marks the appointment `appointmentId` attended, as the admin. */
async function markAttended(appointmentId: string) {
  expectOk(
    await world.organization.changeAppointmentStatus(adminCaller, {
      appointmentId,
      status: "attended",
    }),
  );
}

/** The queued care instructions and follow-ups, as their kind and when each is due. */
async function queuedAftercare() {
  return (await outbox())
    .filter((row) => row.state === "queued" && row.kind !== "bookingConfirmation")
    .map(({ kind, dueAt }) => ({ kind, dueAt }));
}

describe("queueing care instructions and the follow-up", () => {
  it("queues the care instructions, due at once, when an appointment is marked attended", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas." });
    const { appointmentId } = await bookMartina();

    await markAttended(appointmentId);

    expect(await queuedAftercare()).toEqual([{ kind: "careInstructions", dueAt: Date.now() }]);
  });

  it("queues none when the medical service has no care instructions or follow-up", async () => {
    const { appointmentId } = await bookMartina();

    await markAttended(appointmentId);

    expect(await queuedAftercare()).toEqual([]);
  });

  it("queues the follow-up for the appointment's end plus the medical service's hours", async () => {
    await setMessages({ followUpHours: 72 });
    const { appointmentId } = await bookMartina();

    await markAttended(appointmentId);

    const endsAt = +nineOnMonday + 30 * 60_000;
    expect(await queuedAftercare()).toEqual([{ kind: "followUp", dueAt: endsAt + hours(72) }]);
  });

  it("queues none for a patient without WhatsApp consent", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas.", followUpHours: 72 });
    const { patient, appointmentId } = await bookMartina();
    expectOk(
      await world.organization.setWhatsappConsent(adminCaller, {
        patientId: patient.id,
        whatsappConsent: false,
      }),
    );

    await markAttended(appointmentId);

    expect(await queuedAftercare()).toEqual([]);
  });

  it("drops both when marking it attended is undone", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas.", followUpHours: 72 });
    const { appointmentId } = await bookMartina();
    await markAttended(appointmentId);

    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    expect(await queuedAftercare()).toEqual([]);
    expect(
      (await outbox()).filter((row) => row.kind !== "bookingConfirmation").map((row) => row.state),
    ).toEqual(["dropped", "dropped"]);
  });
});

describe("sending care instructions and the follow-up", () => {
  beforeEach(async () => {
    await submitTemplate("indicaciones", careInstructionsBody, "APPROVED", "900000000000021");
    await submitTemplate("seguimiento", followUpBody, "APPROVED", "900000000000022");
    fakeMeta.answerWith(200, metaSent("wamid.aftercare"));
  });

  /** The parameters of each message the object sent Meta, in order. */
  function sentParameters() {
    return sentToMeta().map(
      (request) =>
        (
          request.body as {
            template: { components: { parameters: { parameter_name: string; text: string }[] }[] };
          }
        ).template.components[0]!.parameters,
    );
  }

  it("sends care instructions written as lines as one line, joined with `; `", async () => {
    await setMessages({
      careInstructions:
        "No comer por 2 horas.\n\tEvitá el sol directo.\r\nTomá el analgésico      cada 8 horas.",
    });
    const { appointmentId } = await bookMartina();
    await markAttended(appointmentId);

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["indicaciones_v1"]);
    const instructions = sentParameters()[0]!.find(
      (parameter) => parameter.parameter_name === "indicaciones",
    )!.text;
    expect(instructions).toBe(
      "No comer por 2 horas.; Evitá el sol directo.; Tomá el analgésico cada 8 horas.",
    );
    expect(instructions).not.toMatch(/[\n\t]| {5}/);
    const [stored] = await storedMessages();
    expect(stored!.text).toBe(
      "Hola Martina, te dejamos las indicaciones de Juan Gómez para después de tu turno: No comer por 2 horas.; Evitá el sol directo.; Tomá el analgésico cada 8 horas.. Cualquier duda, respondé este mensaje. Consultorios Prueba",
    );
    expect(await outbox()).toEqual([expect.objectContaining({ state: "sent" })]);
  });

  it("sends the follow-up as `seguimiento` at its time, days after the appointment", async () => {
    await setMessages({ followUpHours: 72 });
    const { appointmentId } = await bookMartina();
    await markAttended(appointmentId);
    const dueAt = +nineOnMonday + 30 * 60_000 + hours(72);

    vi.setSystemTime(dueAt - 1);
    await runDurableObjectAlarm(world.organization);
    expect(sentToMeta()).toEqual([]);

    vi.setSystemTime(dueAt);
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual(["seguimiento_v1"]);
    const [stored] = await storedMessages();
    expect(stored!.text).toBe(
      "Hola Martina, ¿cómo te sentís después de tu turno del lunes 5 de enero con Juan Gómez? Contanos respondiendo este mensaje. Consultorios Prueba",
    );
  });

  it("still sends care instructions held weeks past the appointment while Meta paused the template", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas." });
    const { appointmentId } = await bookMartina();
    await templateTurns("900000000000021", "paused");
    await markAttended(appointmentId);
    await runDurableObjectAlarm(world.organization);
    expect(sentToMeta()).toEqual([]);

    vi.setSystemTime(+nineOnMonday + hours(24 * 21));
    await templateTurns("900000000000021", "approved");
    expect(await runDurableObjectAlarm(world.organization)).toBe(true);

    expect(sentTemplates()).toEqual(["indicaciones_v1"]);
  });

  it("drops the care instructions when the medical service cleared them before they went", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas." });
    const { appointmentId } = await bookMartina();
    await templateTurns("900000000000021", "paused");
    await markAttended(appointmentId);

    await setMessages({ careInstructions: null });
    await templateTurns("900000000000021", "approved");
    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: "noCareInstructions" }),
    ]);
  });

  it("sends nothing once marking the appointment attended is undone before the alarm fires", async () => {
    await setMessages({ careInstructions: "No comer por 2 horas.", followUpHours: 1 });
    const { appointmentId } = await bookMartina();
    await markAttended(appointmentId);
    expectOk(await world.organization.undoAppointmentStatus(adminCaller, { appointmentId }));

    vi.setSystemTime(+nineOnMonday + hours(2));
    await runDurableObjectAlarm(world.organization);

    expect(sentToMeta()).toEqual([]);
  });
});
