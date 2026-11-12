import { eq } from "drizzle-orm";
import { variablesIn } from "#/lib/template-filling.ts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  checkTemplateBody,
  metaTemplateName,
  templateVariables,
} from "#/lib/whatsapp-templates.ts";
import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  setUpBookingWorld,
  submitTemplate,
  templateNamed,
} from "#/organization/organization.test-support.ts";
import { template } from "#/organization/whatsapp-schema.ts";

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

describe("the drafts every organization starts with", () => {
  it("name the organization, and pass the rules check as they stand", async () => {
    const drafts = (await listed()).map(({ id, draft }) => ({ id, draft: draft! }));

    expect(drafts).toHaveLength(9);
    for (const { id, draft } of drafts) {
      expect(variablesIn(draft)).toContain("organizacion");
      expect(checkTemplateBody(templateVariables(id), draft)).toEqual({ ok: true, body: draft });
    }
  });
});

describe("the drafts never sent, when an admin changes Trato", () => {
  const usted = { formOfAddress: "usted", tone: "", phone: "" } as const;

  /** Each template's draft by its name. */
  async function draftsByName() {
    return Object.fromEntries((await listed()).map(({ name, draft }) => [name, draft]));
  }

  it("are reworded in the Trato saved, every one of them, and back again", async () => {
    const inVos = await draftsByName();

    expectOk(await world.organization.saveCommunicationRules(adminCaller, usted));

    const inUsted = await draftsByName();
    expect(inUsted["Confirmación del turno"]).toBe(
      "Hola {{paciente}}, le escribimos de {{organizacion}}: su turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesita cambiarlo, responda este mensaje.",
    );
    expect(inUsted["Reabrir la conversación"]).toBe(
      "Hola {{paciente}}, le escribimos de {{organizacion}}: tenemos una respuesta para usted. Responda este mensaje para verla.",
    );
    for (const draft of Object.values(inUsted)) {
      expect(draft).toMatch(/^Hola \{\{paciente\}\}, le escribimos de \{\{organizacion\}\}/);
    }

    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        ...usted,
        formOfAddress: "vos",
      }),
    );

    expect(await draftsByName()).toEqual(inVos);
  });

  it("are audited each with the text it had, by the admin who saved, and only when reworded", async () => {
    const draftId = await templateNamed(world.organization, "Seguimiento");
    const inVos = (await listed()).find((one) => one.id === draftId)!.draft;

    expectOk(
      await world.organization.saveCommunicationRules(adminCaller, {
        ...usted,
        formOfAddress: "vos",
      }),
    );
    expect(await auditEntriesFor(world.organization, draftId)).toEqual([]);

    expectOk(await world.organization.saveCommunicationRules(adminCaller, usted));

    expect(await auditEntriesFor(world.organization, draftId)).toEqual([
      {
        action: "update",
        entityType: "template",
        userId: adminCaller.userId,
        patientId: null,
        before: { draft: inVos },
        after: {
          draft:
            "Hola {{paciente}}, le escribimos de {{organizacion}} por su turno del {{fecha}} con {{profesional}}. Cuéntenos cómo se siente respondiendo este mensaje.",
        },
      },
    ]);
  });

  it("leave a template already sent to Meta, and a text the organization wrote, as they are", async () => {
    const sentId = await templateNamed(world.organization, "Recordatorio");
    await submitTemplate(world.organization, sentId, { status: "PENDING", metaId: "703" });
    const writtenId = await templateNamed(world.organization, "Seguimiento");
    const written = "Hola {{paciente}}, gracias por venir a {{organizacion}}. Te esperamos pronto.";
    await inStorage(world.organization, (database) =>
      database.update(template).set({ draft: written }).where(eq(template.id, writtenId)).run(),
    );
    const before = await draftsByName();

    expectOk(await world.organization.saveCommunicationRules(adminCaller, usted));

    const after = await listed();
    const sent = after.find((one) => one.id === sentId)!;
    expect(sent.draft).toBe(before["Recordatorio"]);
    expect(sent.versions.map((version) => version.body)).toEqual([before["Recordatorio"]]);
    expect(after.find((one) => one.id === writtenId)!.draft).toBe(written);
    expect(await auditEntriesFor(world.organization, sentId)).toEqual([]);
    expect(after.filter((one) => !one.followsTrato).map((one) => one.name)).toEqual([
      "Recordatorio",
      "Seguimiento",
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

  it("reads a name without case beyond ASCII letters too", async () => {
    fakeMeta.answerNextWith(200, { id: "700", status: "PENDING", category: "UTILITY" });
    expectOk(
      await world.organization.createTemplate(adminCaller, { ...newTemplate, name: "Señal" }),
    );

    const answer = await world.organization.createTemplate(adminCaller, {
      ...newTemplate,
      name: "SEÑAL",
    });

    expect(answer).toEqual({ ok: false, reason: "nameTaken" });
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

  it("submits a draft as it stands on its first save, to Meta in the organization's name", async () => {
    const draftId = await templateNamed(world.organization, "Recordatorio");
    const draft = (await listed()).find((one) => one.id === draftId)!.draft!;
    fakeMeta.answerNextWith(200, { id: "701", status: "PENDING", category: "UTILITY" });

    const answer = await world.organization.editTemplate(adminCaller, {
      templateId: draftId,
      body: draft,
      settings: { name: "Recordatorio", timing: { when: "before", hours: 3 } },
    });

    expect(answer).toEqual({ ok: true, submitted: true });
    expect(createdAtMeta()).toEqual([metaTemplateName(draftId, 1)]);
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

describe("auditing a template", () => {
  it("records its new name and timing, and each text sent to Meta with the one before", async () => {
    fakeMeta.answerNextWith(200, { id: "700", status: "PENDING", category: "UTILITY" });
    const { templateId } = expectOk(
      await world.organization.createTemplate(adminCaller, newTemplate),
    );
    fakeMeta.answerNextWith(200, { id: "701", status: "PENDING", category: "UTILITY" });

    expectOk(
      await world.organization.editTemplate(adminCaller, {
        templateId,
        body: `${body} Gracias.`,
        settings: { name: "Estudios previos", timing: { when: "after", hours: 1 } },
      }),
    );

    expect((await auditEntriesFor(world.organization, templateId)).slice(1)).toMatchObject([
      {
        action: "update",
        before: { name: "Estudios", timing: "before", timingHours: 72 },
        after: { name: "Estudios previos", timing: "after", timingHours: 1 },
      },
    ]);
    const [second, first] = (await listed()).find((one) => one.id === templateId)!.versions;
    expect(await auditEntriesFor(world.organization, first!.id)).toMatchObject([
      {
        action: "create",
        entityType: "whatsappTemplate",
        before: null,
        after: { version: 1, body },
      },
    ]);
    expect(await auditEntriesFor(world.organization, second!.id)).toMatchObject([
      {
        action: "create",
        entityType: "whatsappTemplate",
        userId: adminCaller.userId,
        before: { version: 1, body },
        after: { version: 2, body: `${body} Gracias.` },
      },
    ]);
  });
});

describe("auditing a draft", () => {
  it("records the draft as the text its first version replaces", async () => {
    const draftId = await templateNamed(world.organization, "Recordatorio");
    const draft = (await listed()).find((one) => one.id === draftId)!.draft!;
    fakeMeta.answerNextWith(200, { id: "702", status: "PENDING", category: "UTILITY" });

    expectOk(
      await world.organization.editTemplate(adminCaller, {
        templateId: draftId,
        body: `${draft} Gracias.`,
        settings: { name: "Recordatorio", timing: { when: "before", hours: 2 } },
      }),
    );

    const [first] = (await listed()).find((one) => one.id === draftId)!.versions;
    expect(await auditEntriesFor(world.organization, first!.id)).toMatchObject([
      { before: { version: 0, body: draft }, after: { version: 1, body: `${draft} Gracias.` } },
    ]);
  });
});

describe("deleting a template", () => {
  it("deletes one never sent to Meta that no medical service sends", async () => {
    const draftId = await templateNamed(world.organization, "Seguimiento");

    expectOk(await world.organization.deleteTemplate(adminCaller, { templateId: draftId }));

    expect((await listed()).map((one) => one.id)).not.toContain(draftId);
    expect(await auditEntriesFor(world.organization, draftId)).toMatchObject([
      {
        action: "delete",
        entityType: "template",
        before: { name: "Seguimiento", draft: expect.stringContaining("{{organizacion}}") },
        after: null,
      },
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
