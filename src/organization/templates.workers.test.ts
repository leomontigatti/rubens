import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { metaTemplateName } from "#/lib/whatsapp-templates.ts";
import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  setUpBookingWorld,
  templateNamed,
} from "#/organization/organization.test-support.ts";

// The organization's templates as an admin manages them (`templates.ts`):
// its own, created, named, timed and deleted while never sent, and the event
// templates, whose text alone is written.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const body =
  "Hola {{paciente}}, traé tus estudios a tu turno del {{fecha}} a las {{hora}}. Consultorios Prueba";

const newTemplate = { name: "Estudios", timing: { when: "before", hours: 72 }, body } as const;

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

/** The templates the settings list, as their name and whether each is an event's. */
async function listed() {
  const settings = expectOk(await world.organization.whatsappSettings(adminCaller));
  return settings.templates;
}

/** The names the object created at Meta, in order. */
function createdAtMeta() {
  return fakeMeta.requests
    .filter((request) => request.method === "POST")
    .map((request) => (request.body as { name: string }).name);
}

beforeEach(async () => {
  fakeMeta.reset();
  world = await setUpBookingWorld();
});

describe("the organization's templates", () => {
  it("start with the four drafts, unsent, in the order they go, and the event templates after them", async () => {
    expect(
      (await listed()).map(({ name, event, timing, versions }) => ({
        name,
        event,
        timing,
        sent: versions.length > 0,
      })),
    ).toEqual([
      { name: "Confirmación del turno", event: false, timing: { when: "booking" }, sent: false },
      {
        name: "Recordatorio con confirmación",
        event: false,
        timing: { when: "before", hours: 24 },
        sent: false,
      },
      { name: "Recordatorio", event: false, timing: { when: "before", hours: 2 }, sent: false },
      { name: "Seguimiento", event: false, timing: { when: "after", hours: 24 }, sent: false },
      { name: "Turno movido", event: true, timing: null, sent: false },
      { name: "Turno cancelado", event: true, timing: null, sent: false },
      { name: "Turno a reprogramar", event: true, timing: null, sent: false },
      { name: "Solicitud no confirmada", event: true, timing: null, sent: false },
      { name: "Reabrir la conversación", event: true, timing: null, sent: false },
    ]);
  });
});

describe("creating a template", () => {
  it("submits its text to Meta under its id, and lists it by its timing with its first version", async () => {
    fakeMeta.answerWith(200, { id: "700", status: "PENDING", category: "UTILITY" });

    const created = expectOk(await world.organization.createTemplate(adminCaller, newTemplate));

    expect(createdAtMeta()).toEqual([metaTemplateName(created.templateId, 1)]);
    const names = (await listed()).map((one) => one.name);
    expect(names.indexOf("Estudios")).toBe(names.indexOf("Recordatorio con confirmación") - 1);
    expect((await listed()).find((one) => one.id === created.templateId)).toMatchObject({
      timing: { when: "before", hours: 72 },
      versions: [{ version: 1, metaId: "700", body }],
    });
    expect(await auditEntriesFor(world.organization, created.templateId)).toMatchObject([
      { action: "create", entityType: "template", after: { name: "Estudios", timingHours: 72 } },
    ]);
  });

  it("refuses a name another template has, in any case, an event template's too, and submits nothing", async () => {
    const answers = [
      await world.organization.createTemplate(adminCaller, {
        ...newTemplate,
        name: "recordatorio",
      }),
      await world.organization.createTemplate(adminCaller, {
        ...newTemplate,
        name: "Turno movido",
      }),
    ];

    expect(answers).toEqual([
      { ok: false, reason: "nameTaken" },
      { ok: false, reason: "nameTaken" },
    ]);
    expect(fakeMeta.requests).toEqual([]);
  });

  it("refuses a second template by a name a first one still waits for Meta with", async () => {
    fakeMeta.answerWith(200, { id: "700", status: "PENDING", category: "UTILITY" });
    const release = fakeMeta.holdNext();
    const first = world.organization.createTemplate(adminCaller, newTemplate);
    await fakeMeta.received(1);

    const second = await world.organization.createTemplate(adminCaller, {
      ...newTemplate,
      name: "ESTUDIOS",
    });
    release();

    expect(second).toEqual({ ok: false, reason: "nameTaken" });
    expectOk(await first);
  });

  it("creates nothing when Meta refuses the text", async () => {
    fakeMeta.answerWith(400, { error: { message: "Invalid parameter", code: 100 } });

    const answer = await world.organization.createTemplate(adminCaller, newTemplate);

    expect(answer).toMatchObject({ ok: false, reason: "metaRefused" });
    expect((await listed()).map((one) => one.name)).not.toContain("Estudios");
  });

  it("refuses a variable that no appointment fills", async () => {
    const answer = await world.organization.createTemplate(adminCaller, {
      ...newTemplate,
      body: "Hola {{paciente}}, seguí estas {{indicaciones}} por favor.",
    });

    expect(answer).toEqual({
      ok: false,
      reason: "invalidTemplate",
      problems: [{ kind: "unknownVariable", variable: "indicaciones" }],
    });
  });
});

describe("editing a template", () => {
  let templateId: string;

  beforeEach(async () => {
    fakeMeta.answerNextWith(200, { id: "700", status: "APPROVED", category: "UTILITY" });
    templateId = expectOk(
      await world.organization.createTemplate(adminCaller, newTemplate),
    ).templateId;
    fakeMeta.requests = [];
  });

  it("saves a new name and timing with the text unchanged, and submits nothing to Meta", async () => {
    const answer = await world.organization.editTemplate(adminCaller, {
      templateId,
      body: `  ${body}\n`,
      settings: { name: "Estudios previos", timing: { when: "before", hours: 48 } },
    });

    expect(answer).toEqual({ ok: true, submitted: false });
    expect(fakeMeta.requests).toEqual([]);
    expect((await listed()).find((one) => one.id === templateId)).toMatchObject({
      name: "Estudios previos",
      timing: { when: "before", hours: 48 },
      versions: [{ version: 1 }],
    });
  });

  it("submits a changed text as the next version, with the new name and timing", async () => {
    fakeMeta.answerNextWith(200, { id: "701", status: "PENDING", category: "UTILITY" });

    const answer = await world.organization.editTemplate(adminCaller, {
      templateId,
      body: `${body} Gracias.`,
      settings: { name: "Estudios previos", timing: { when: "after", hours: 1 } },
    });

    expect(answer).toEqual({ ok: true, submitted: true });
    expect(createdAtMeta()).toEqual([metaTemplateName(templateId, 2)]);
    expect((await listed()).find((one) => one.id === templateId)).toMatchObject({
      name: "Estudios previos",
      timing: { when: "after", hours: 1 },
    });
  });

  it("keeps the new name and timing when Meta refuses the changed text, and stores no version", async () => {
    fakeMeta.answerNextWith(400, { error: { message: "Invalid parameter", code: 100 } });

    const answer = await world.organization.editTemplate(adminCaller, {
      templateId,
      body: `${body} Gracias.`,
      settings: { name: "Estudios previos", timing: { when: "after", hours: 1 } },
    });

    expect(answer).toMatchObject({ ok: false, reason: "metaRefused" });
    expect((await listed()).find((one) => one.id === templateId)).toMatchObject({
      name: "Estudios previos",
      timing: { when: "after", hours: 1 },
      versions: [{ version: 1 }],
    });
  });

  it("saves nothing when the changed text fails the rules check", async () => {
    await world.organization.editTemplate(adminCaller, {
      templateId,
      body: "{{paciente}}, nos vemos",
      settings: { name: "Estudios previos", timing: { when: "after", hours: 1 } },
    });

    expect((await listed()).find((one) => one.id === templateId)).toMatchObject({
      name: "Estudios",
      timing: { when: "before", hours: 72 },
    });
  });

  it("submits a draft on its first save, which refuses the sign-off's placeholder left in place", async () => {
    const draftId = await templateNamed(world.organization, "Recordatorio");
    const draft = (await listed()).find((one) => one.id === draftId)!.draft!;

    const answer = await world.organization.editTemplate(adminCaller, {
      templateId: draftId,
      body: draft,
      settings: { name: "Recordatorio", timing: { when: "before", hours: 3 } },
    });

    expect(answer).toEqual({
      ok: false,
      reason: "invalidTemplate",
      problems: [{ kind: "signOffPlaceholder" }],
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("takes a name and timing for the organization's own only, never for an event template", async () => {
    const answers = [
      await world.organization.editTemplate(adminCaller, { templateId, body, settings: null }),
      await world.organization.editTemplate(adminCaller, {
        templateId: "turno_movido",
        body,
        settings: { name: "Movido", timing: { when: "booking" } },
      }),
    ];

    expect(answers).toEqual([
      { ok: false, reason: "invalidInput" },
      { ok: false, reason: "invalidInput" },
    ]);
  });
});

describe("deleting a template", () => {
  it("deletes one never sent to Meta that no medical service sends", async () => {
    const draftId = await templateNamed(world.organization, "Seguimiento");

    expectOk(await world.organization.deleteTemplate(adminCaller, { templateId: draftId }));

    expect((await listed()).map((one) => one.id)).not.toContain(draftId);
    expect(await auditEntriesFor(world.organization, draftId)).toMatchObject([
      { action: "delete", entityType: "template", before: { name: "Seguimiento" } },
    ]);
  });

  it("refuses one a medical service sends, one already sent to Meta, and an event template", async () => {
    const picked = await templateNamed(world.organization, "Seguimiento");
    const service = await world.addMedicalService(world.juan.practitionerId);
    await world.pickTemplates(service.id, [picked]);
    fakeMeta.answerNextWith(200, { id: "700", status: "PENDING", category: "UTILITY" });
    const sent = expectOk(await world.organization.createTemplate(adminCaller, newTemplate));

    const answers = [
      await world.organization.deleteTemplate(adminCaller, { templateId: picked }),
      await world.organization.deleteTemplate(adminCaller, { templateId: sent.templateId }),
      await world.organization.deleteTemplate(adminCaller, { templateId: "turno_movido" }),
    ];

    expect(answers.map((answer) => (answer.ok ? "deleted" : answer.reason))).toEqual([
      "picked",
      "submitted",
      "invalidInput",
    ]);
  });
});

describe("who manages templates", () => {
  it("is a signed-in admin only: anyone else is refused creating, editing and deleting", async () => {
    const draftId = await templateNamed(world.organization, "Seguimiento");
    const callers = [
      await addMember(world.organization, ["receptionist"]),
      await addMember(world.organization, ["practitioner"]),
      { userId: "user-stranger" },
      await addRefusedAdmin(world.organization, "deactivated"),
      await addRefusedAdmin(world.organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.flatMap((caller) => [
        world.organization.createTemplate(caller, newTemplate),
        world.organization.editTemplate(caller, {
          templateId: "turno_movido",
          body,
          settings: null,
        }),
        world.organization.deleteTemplate(caller, { templateId: draftId }),
      ]),
    );

    expect(answers.map((answer) => (answer.ok ? "done" : answer.reason))).toEqual([
      ...Array(6).fill("forbidden"),
      ...Array(6).fill("unauthenticated"),
      ...Array(3).fill("mustChangePassword"),
    ]);
    expect(fakeMeta.requests).toEqual([]);
  });
});
