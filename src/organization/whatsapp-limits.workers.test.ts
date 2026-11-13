import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { WhatsappNumberEvent, WhatsappTemplateStatusUpdate } from "#/lib/whatsapp-messages.ts";
import { metaTemplateName } from "#/lib/whatsapp-templates.ts";

import {
  addMember,
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
import { outboxMessage, whatsappConnection } from "#/organization/whatsapp-schema.ts";

// When Meta limits the number or a template (docs/domain/messages.md § When
// Meta limits the number): the webhook's events change the template or the
// number, every admin is told at once, and the outbox's messages wait instead
// of failing, to go once the number or the template can be used again.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

type TemplateKey = "confirmation" | "reminder" | "careInstructions" | "turno_cancelado";

const bodies: Record<TemplateKey, string> = {
  confirmation:
    "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Consultorios Prueba",
  reminder:
    "Hola {{paciente}}, te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Respondé para confirmar que venís.",
  careInstructions:
    "Hola {{paciente}}, no comas por 2 horas después de tu turno con {{profesional}}. Consultorios Prueba",
  turno_cancelado:
    "Hola {{paciente}}, tuvimos que cancelar tu turno del {{fecha}}. Respondé este mensaje. Consultorios Prueba",
};

const hours = (count: number) => count * 60 * 60_000;
const nineOnMonday = at("12:00");

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;
let medicalServiceId: string;
/**
 * The templates the tests submit: the booking confirmation and a reminder 48
 * hours before, from the drafts; care instructions sent on the attendance,
 * one of the organization's own; and an event template.
 */
let ids: Record<TemplateKey, string>;
/** How many versions of each the test submitted, so each version's text differs. */
let submitted: Partial<Record<TemplateKey, number>>;

/** Submits a version of template `key` as the admin, Meta answering `status` with `metaId`. */
async function submit(key: TemplateKey, status: "APPROVED" | "PENDING", metaId: string) {
  const version = (submitted[key] ?? 0) + 1;
  submitted[key] = version;
  const body = version === 1 ? bodies[key] : `${bodies[key]} (${version})`;
  if (key === "careInstructions" && version === 1) {
    fakeMeta.answerNextWith(200, { id: metaId, status, category: "UTILITY" });
    ids.careInstructions = expectOk(
      await world.organization.createTemplate(adminCaller, {
        name: "Indicaciones",
        timing: { when: "attended" },
        body,
      }),
    ).templateId;
    fakeMeta.requests = [];
    return;
  }
  const timing = key === "reminder" ? ({ when: "before", hours: 48 } as const) : undefined;
  await submitTemplate(world.organization, ids[key], { status, metaId, body, timing });
}

/** The medical service's messages: none but those given. */
function setMessages(
  messages: Partial<{ bookingConfirmation: boolean; reminder: boolean; careInstructions: boolean }>,
) {
  return world.pickTemplates(medicalServiceId, [
    ...(messages.bookingConfirmation ? [ids.confirmation] : []),
    ...(messages.reminder ? [ids.reminder] : []),
    ...(messages.careInstructions ? [ids.careInstructions] : []),
  ]);
}

/** Books Martina at 09:00 in Buenos Aires on the first Monday. */
async function bookMartina() {
  const patient = await world.addPatient("Martina", "+5491155550000");
  const booked = await world.book({
    practitionerId: world.juan.practitionerId,
    patientId: patient.id,
    medicalServiceId,
    start: nineOnMonday,
    durationMinutes: 30,
  });
  return booked.id;
}

function templateTurns(update: WhatsappTemplateStatusUpdate) {
  return world.organization.storeWhatsappEvents({
    messages: [],
    statuses: [],
    templateStatuses: [update],
  });
}

function numberTurns(event: WhatsappNumberEvent) {
  return world.organization.storeWhatsappEvents({
    messages: [],
    statuses: [],
    templateStatuses: [],
    numberEvents: [event],
  });
}

/** The template name of each message the object sent Meta, in order. */
function sentTemplates() {
  return fakeMeta.requests
    .filter((request) => request.url.endsWith("/messages"))
    .map((request) => (request.body as { template: { name: string } }).template.name);
}

function outbox() {
  return inStorage(world.organization, (database) =>
    database
      .select({
        templateId: outboxMessage.templateId,
        state: outboxMessage.state,
        attempts: outboxMessage.attempts,
        dropReason: outboxMessage.dropReason,
        dueAt: outboxMessage.dueAt,
      })
      .from(outboxMessage)
      .all(),
  );
}

async function notificationsOf(caller: { userId: string }) {
  return expectOk(await world.organization.listNotifications(caller)).notifications;
}

beforeEach(async () => {
  // A month before the appointments, so the runtime's own alarm never fires mid-test.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  medicalServiceId = (await world.addMedicalService(world.juan.practitionerId)).id;
  submitted = {};
  ids = {
    confirmation: await templateNamed(world.organization, "Confirmación del turno"),
    reminder: await templateNamed(world.organization, "Recordatorio con confirmación"),
    careInstructions: "",
    turno_cancelado: "turno_cancelado",
  };
  // As a medical service starts in these tests: sending the booking confirmation.
  await setMessages({ bookingConfirmation: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a template Meta stops", () => {
  it("notifies every active admin when Meta rejects it, with the template and the messages waiting", async () => {
    // An event template's message queues on its event whatever Meta said of it.
    await submit("turno_cancelado", "PENDING", "900000000000001");
    const appointmentId = await bookMartina();
    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "business",
        reason: null,
      }),
    );
    const otherAdmin = await addMember(world.organization, ["admin"]);
    const deactivated = await addRefusedAdmin(world.organization, "deactivated");

    expectOk(
      await templateTurns({
        metaId: "900000000000001",
        status: "rejected",
        reason: "INVALID_FORMAT",
      }),
    );

    const expected = [
      expect.objectContaining({
        kind: "templateRejected",
        templateId: "turno_cancelado",
        templateName: "Turno cancelado",
        templateVersion: 1,
        detail: "INVALID_FORMAT",
        waiting: 1,
        read: false,
      }),
    ];
    expect(await notificationsOf(adminCaller)).toEqual(expected);
    expect(await notificationsOf(otherAdmin)).toEqual(expected);
    expect(await notificationsOf(world.receptionist)).toEqual([]);
    expect(await notificationsOf(world.juan.caller)).toEqual([]);
    const stored = await inStorage(world.organization, (database) =>
      database.query.notification.findMany(),
    );
    expect(stored.map((row) => row.recipientId)).not.toContain(deactivated.userId);
  });

  it("notifies once when Meta repeats the same status", async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
    const paused = { metaId: "900000000000001", status: "paused", reason: null } as const;

    await templateTurns(paused);
    await templateTurns(paused);

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "templatePaused", templateId: ids.confirmation }),
    ]);
  });

  it("counts no message waiting when another approved version still goes", async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
    await submit("confirmation", "APPROVED", "900000000000002");
    await bookMartina();

    await templateTurns({ metaId: "900000000000002", status: "disabled", reason: null });

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "templateDisabled", templateVersion: 2, waiting: 0 }),
    ]);
  });

  it("warns when a refresh from the settings finds a template Meta paused", async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
    fakeMeta.answerWith(200, { id: "900000000000001", status: "PAUSED" });

    expectOk(await world.organization.refreshWhatsappTemplates(adminCaller));
    const warned = [
      expect.objectContaining({ kind: "templatePaused", templateId: ids.confirmation }),
    ];
    expect(await notificationsOf(adminCaller)).toEqual(warned);
    await templateTurns({ metaId: "900000000000001", status: "paused", reason: null });

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "templatePaused", templateId: ids.confirmation }),
    ]);
  });

  it("counts no message waiting when the same refresh finds another version approved", async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
    await submit("confirmation", "PENDING", "900000000000002");
    await bookMartina();
    fakeMeta.answerNextWith(200, { id: "900000000000001", status: "PAUSED" });
    fakeMeta.answerNextWith(200, { id: "900000000000002", status: "APPROVED" });

    expectOk(await world.organization.refreshWhatsappTemplates(adminCaller));

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "templatePaused", templateVersion: 1, waiting: 0 }),
    ]);
  });

  it("holds a template's messages once Meta moves it out of utility, until a utility version is approved", async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
    await bookMartina();

    expectOk(
      await world.organization.storeWhatsappEvents({
        messages: [],
        statuses: [],
        templateStatuses: [],
        templateCategories: [{ metaId: "900000000000001", category: "MARKETING" }],
      }),
    );
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([]);
    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({
        kind: "templateRecategorized",
        templateId: ids.confirmation,
        templateVersion: 1,
        detail: "MARKETING",
        waiting: 1,
      }),
    ]);
    const settings = expectOk(await world.organization.whatsappSettings(adminCaller));
    expect(settings.templates[0]!.versions).toEqual([
      expect.objectContaining({ version: 1, status: "approved", category: "marketing" }),
    ]);

    await submit("confirmation", "APPROVED", "900000000000002");
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([metaTemplateName(ids.confirmation, 2)]);
  });
});

describe("a number Meta restricts", () => {
  beforeEach(async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
  });

  it("holds every due message until the restriction expires, then sends them", async () => {
    const until = Date.now() + hours(24);
    expectOk(await numberTurns({ kind: "restricted", until }));
    await bookMartina();

    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([]);
    expect(await outbox()).toEqual([expect.objectContaining({ state: "queued", attempts: 0 })]);

    vi.setSystemTime(until);
    expect(await runDurableObjectAlarm(world.organization)).toBe(true);

    expect(sentTemplates()).toEqual([metaTemplateName(ids.confirmation, 1)]);
  });

  it("warns every admin with how long and how many messages wait", async () => {
    await bookMartina();
    const until = Date.now() + hours(24);

    await numberTurns({ kind: "restricted", until });

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "numberRestricted", until, waiting: 1, read: false }),
    ]);
  });

  it("sends the held messages once Meta lifts the restriction", async () => {
    await numberTurns({ kind: "restricted", until: null });
    await bookMartina();
    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([]);

    await numberTurns({ kind: "unrestricted" });

    expect(await runDurableObjectAlarm(world.organization)).toBe(true);
    expect(sentTemplates()).toEqual([metaTemplateName(ids.confirmation, 1)]);
  });

  it("drops a held reminder for an appointment cancelled meanwhile", async () => {
    await submit("reminder", "APPROVED", "900000000000011");
    await setMessages({ reminder: true });
    const appointmentId = await bookMartina();
    await numberTurns({ kind: "restricted", until: null });
    vi.setSystemTime(+nineOnMonday - hours(48));
    await runDurableObjectAlarm(world.organization);

    expectOk(
      await world.organization.cancelAppointment(adminCaller, {
        appointmentId,
        cancelledBy: "patient",
        reason: null,
      }),
    );
    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([]);
    expect(await outbox()).toEqual([
      expect.objectContaining({
        templateId: ids.reminder,
        state: "dropped",
        dropReason: "appointmentChanged",
      }),
    ]);
  });

  it("replaces a held reminder for an appointment moved meanwhile with the reminder for its new time", async () => {
    await submit("reminder", "APPROVED", "900000000000011");
    await setMessages({ reminder: true });
    const appointmentId = await bookMartina();
    await numberTurns({ kind: "restricted", until: null });
    vi.setSystemTime(+nineOnMonday - hours(48));
    await runDurableObjectAlarm(world.organization);
    const nextMonday = at("12:00", "2099-01-12");

    expectOk(
      await world.organization.rescheduleAppointment(adminCaller, {
        appointmentId,
        start: nextMonday,
        durationMinutes: 30,
      }),
    );
    await numberTurns({ kind: "unrestricted" });
    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([]);

    vi.setSystemTime(+nextMonday - hours(48));
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([metaTemplateName(ids.reminder, 1)]);
    const sent = fakeMeta.requests.find((request) => request.url.endsWith("/messages"))!;
    expect(JSON.stringify(sent.body)).toContain("lunes 12 de enero");
    expect(await outbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "dropped", dropReason: "appointmentChanged" }),
        expect.objectContaining({ state: "sent", dueAt: +nextMonday - hours(48) }),
      ]),
    );
  });

  it("still sends care instructions held weeks while the account was disabled, with no attempt spent", async () => {
    await submit("careInstructions", "APPROVED", "900000000000021");
    await setMessages({ careInstructions: true });
    const appointmentId = await bookMartina();
    await numberTurns({ kind: "disabled" });
    expectOk(
      await world.organization.changeAppointmentStatus(adminCaller, {
        appointmentId,
        status: "attended",
      }),
    );
    vi.setSystemTime(+nineOnMonday + hours(24 * 21));
    await runDurableObjectAlarm(world.organization);
    expect(await outbox()).toEqual([expect.objectContaining({ state: "queued", attempts: 0 })]);

    await numberTurns({ kind: "reinstated" });
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([metaTemplateName(ids.careInstructions, 1)]);
  });

  it("holds the rest when Meta refuses a send for the number's rate limit, keeping its attempts, and warns the admins", async () => {
    await bookMartina();
    const other = await world.addPatient("Lucas", "+5491155550001");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: other.id,
      medicalServiceId,
      start: at("12:30"),
      durationMinutes: 30,
    });
    fakeMeta.answerNextWith(400, { error: { code: 131048, message: "Spam rate limit hit" } });

    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toEqual([metaTemplateName(ids.confirmation, 1)]);
    expect(await outbox()).toEqual([
      expect.objectContaining({ state: "queued", attempts: 0 }),
      expect.objectContaining({ state: "queued", attempts: 0 }),
    ]);
    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "numberRateLimited", waiting: 2 }),
    ]);

    vi.setSystemTime(Date.now() + hours(1));
    for (const id of ["wamid.first", "wamid.second"]) {
      fakeMeta.answerNextWith(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
        messages: [{ id }],
      });
    }
    await runDurableObjectAlarm(world.organization);

    expect(sentTemplates()).toHaveLength(3);
    expect((await outbox()).map((row) => row.state)).toEqual(["sent", "sent"]);
  });
});

describe("a hold on the number and what changes it", () => {
  beforeEach(async () => {
    await submit("confirmation", "APPROVED", "900000000000001");
  });

  it("ends when the organization connects a number on another account, which sends the held messages", async () => {
    await numberTurns({ kind: "disabled" });
    await bookMartina();

    expectOk(
      await world.organization.connectWhatsapp(adminCaller, {
        code: "signup-code",
        phoneNumberId: fakeMeta.signupNumber.phoneNumberId,
        businessAccountId: fakeMeta.signupNumber.businessAccountId,
      }),
    );

    expect(expectOk(await world.organization.whatsappSettings(adminCaller)).hold).toBeNull();
    fakeMeta.requests = [];
    await runDurableObjectAlarm(world.organization);
    expect(sentTemplates()).toEqual([metaTemplateName(ids.confirmation, 1)]);
  });

  it("keeps a hold Meta puts on the new account while its signup is still completing", async () => {
    await numberTurns({ kind: "restricted", until: null });
    await bookMartina();
    const release = fakeMeta.holdSignupStep("subscribe");
    const before = fakeMeta.requests.length;
    const connecting = world.organization.connectWhatsapp(adminCaller, {
      code: "signup-code",
      phoneNumberId: fakeMeta.signupNumber.phoneNumberId,
      businessAccountId: fakeMeta.signupNumber.businessAccountId,
    });
    await fakeMeta.received(before + 5);

    await numberTurns({ kind: "disabled" });
    release();
    expectOk(await connecting);

    expect(expectOk(await world.organization.whatsappSettings(adminCaller)).hold).toMatchObject({
      reason: "disabled",
      until: null,
    });
  });

  it("is not shortened by a send Meta refuses meanwhile for a block", async () => {
    await bookMartina();
    const release = fakeMeta.holdNext();
    fakeMeta.answerNextWith(400, { error: { code: 131031, message: "Account locked" } });
    const alarm = runDurableObjectAlarm(world.organization);
    await fakeMeta.received(1);

    await numberTurns({ kind: "disabled" });
    release();
    await alarm;

    expect(expectOk(await world.organization.whatsappSettings(adminCaller)).hold).toMatchObject({
      reason: "disabled",
      until: null,
    });
    expect((await notificationsOf(adminCaller)).map((row) => row.kind)).toEqual(["numberDisabled"]);
  });

  it("warns once when Meta repeats the same restriction", async () => {
    const restricted = { kind: "restricted", until: Date.now() + hours(24) } as const;

    await numberTurns(restricted);
    await numberTurns(restricted);
    await numberTurns({ kind: "disabled" });
    await numberTurns({ kind: "disabled" });

    expect((await notificationsOf(adminCaller)).map((row) => row.kind).sort()).toEqual([
      "numberDisabled",
      "numberRestricted",
    ]);
  });
});

describe("the number's messaging limit", () => {
  function connectWithLimit(messagingLimit: string) {
    return inStorage(world.organization, (database) =>
      database
        .insert(whatsappConnection)
        .values({
          id: 1,
          businessAccountId: "102290129340398",
          phoneNumberId: "123456789012345",
          displayNumber: "+54 9 351 555-0100",
          messagingLimit,
          state: "disconnected",
          connectedBy: adminCaller.userId,
        })
        .run(),
    );
  }

  it("stores a lowered limit on the connection and warns the admins", async () => {
    await connectWithLimit("TIER_2K");

    await numberTurns({ kind: "messagingLimit", limit: "TIER_250" });

    const settings = expectOk(await world.organization.whatsappSettings(adminCaller));
    expect(settings.connection).toMatchObject({ messagingLimit: "TIER_250" });
    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "messagingLimitLowered", detail: "TIER_250" }),
    ]);
  });

  it("stores a raised limit without a warning", async () => {
    await connectWithLimit("TIER_250");

    await numberTurns({ kind: "messagingLimit", limit: "TIER_2K" });

    const settings = expectOk(await world.organization.whatsappSettings(adminCaller));
    expect(settings.connection).toMatchObject({ messagingLimit: "TIER_2K" });
    expect(await notificationsOf(adminCaller)).toEqual([]);
  });
});

describe("notifications", () => {
  beforeEach(async () => {
    await numberTurns({ kind: "restricted", until: null });
  });

  it("marks a notification read for the admin who read it only", async () => {
    const otherAdmin = await addMember(world.organization, ["admin"]);
    vi.setSystemTime(Date.now() + 60_000);
    await numberTurns({ kind: "disabled" });
    const [notification] = await notificationsOf(adminCaller);

    expectOk(
      await world.organization.markNotificationRead(adminCaller, {
        notificationId: notification!.id,
      }),
    );

    expect(await notificationsOf(adminCaller)).toEqual([
      expect.objectContaining({ kind: "numberRestricted", read: false }),
      expect.objectContaining({ kind: "numberDisabled", read: true }),
    ]);
    expect(expectOk(await world.organization.countUnreadNotifications(adminCaller)).count).toBe(1);
    expect(await notificationsOf(otherAdmin)).toEqual([
      expect.objectContaining({ kind: "numberDisabled", read: false }),
    ]);
  });

  it("lists every unread notification before the read ones, past the list's length", async () => {
    for (let index = 0; index < 50; index += 1) {
      vi.setSystemTime(Date.now() + 60_000);
      await numberTurns({ kind: "restricted", until: Date.now() + hours(24) });
    }
    const listed = await notificationsOf(adminCaller);
    for (const notification of listed) {
      expectOk(
        await world.organization.markNotificationRead(adminCaller, {
          notificationId: notification.id,
        }),
      );
    }

    const [first] = await notificationsOf(adminCaller);

    expect(first).toMatchObject({ kind: "numberRestricted", until: null, read: false });
  });

  it("refuses marking another member's notification", async () => {
    const otherAdmin = await addMember(world.organization, ["admin"]);
    const [notification] = await notificationsOf(adminCaller);

    expect(
      await world.organization.markNotificationRead(otherAdmin, {
        notificationId: notification!.id,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(await notificationsOf(adminCaller)).toEqual([expect.objectContaining({ read: false })]);
  });

  it("refuses a caller who is unknown, deactivated or must still change their password", async () => {
    const [notification] = await notificationsOf(adminCaller);
    const callers = [
      { userId: "user-nobody" },
      await addRefusedAdmin(world.organization, "deactivated"),
      await addRefusedAdmin(world.organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.flatMap((caller) => [
        world.organization.listNotifications(caller),
        world.organization.countUnreadNotifications(caller),
        world.organization.markNotificationRead(caller, { notificationId: notification!.id }),
      ]),
    );

    expect(answers.map((answer) => !answer.ok && answer.reason)).toEqual([
      ...Array(6).fill("unauthenticated"),
      ...Array(3).fill("mustChangePassword"),
    ]);
  });
});
