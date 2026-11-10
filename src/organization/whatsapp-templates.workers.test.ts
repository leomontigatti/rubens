import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  metaAccessToken,
  metaBusinessAccountId,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

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

const body =
  "Hola {{paciente}}, tu turno con {{profesional}} es el {{fecha}} a las {{hora}}. Consultorios Prueba";

const confirmation = { templateName: "confirmacion_turno", body } as const;

let organization: OrganizationStub;

/** Meta's answer to a template it accepted for review. */
function metaCreated(id: string, status = "PENDING") {
  return { id, status, category: "UTILITY" };
}

/** The templates the object created at Meta: its `POST`s, by the name each asked for. */
function createdAtMeta() {
  return fakeMeta.requests
    .filter((request) => request.method === "POST")
    .map((request) => (request.body as { name: string }).name);
}

/** The versions the settings list for `name`, newest first. */
async function versionsOf(name: string) {
  const listed = expectOk(await organization.whatsappSettings(adminCaller));
  return listed.templates.find((template) => template.name === name)!.versions;
}

/** A template status event, as the webhook hands it over. */
function statusEvent(metaId: string, status: string, reason: string | null = null) {
  return {
    messages: [],
    statuses: [],
    templateStatuses: [{ metaId, status, reason }],
  } as Parameters<OrganizationStub["storeWhatsappEvents"]>[0];
}

beforeEach(async () => {
  fakeMeta.reset();
  ({ organization } = await setUpTestOrganization());
});

describe("submitting a template", () => {
  it("creates it at Meta as a utility template in `es_AR`, with named variables and their examples", async () => {
    fakeMeta.answerWith(200, metaCreated("594425479261596"));

    expectOk(await organization.submitWhatsappTemplate(adminCaller, confirmation));

    expect(fakeMeta.requests.filter((request) => request.method === "POST")).toEqual([
      {
        method: "POST",
        url: `https://graph.facebook.com/v26.0/${metaBusinessAccountId}/message_templates`,
        authorization: `Bearer ${metaAccessToken}`,
        body: {
          name: "confirmacion_turno_v1",
          language: "es_AR",
          category: "UTILITY",
          parameter_format: "NAMED",
          components: [
            {
              type: "BODY",
              text: body,
              example: {
                body_text_named_params: [
                  { param_name: "paciente", example: "Lucía" },
                  { param_name: "profesional", example: "la Dra. Sofía Méndez" },
                  { param_name: "fecha", example: "jueves 12 de noviembre" },
                  { param_name: "hora", example: "10:30" },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it("stores it as pending with Meta's id, and each new version under its own name", async () => {
    fakeMeta.answerNextWith(200, metaCreated("111"));
    fakeMeta.answerNextWith(200, metaCreated("222"));

    expectOk(await organization.submitWhatsappTemplate(adminCaller, confirmation));
    expectOk(
      await organization.submitWhatsappTemplate(adminCaller, {
        ...confirmation,
        body: `${body}. Gracias.`,
      }),
    );

    expect(createdAtMeta()).toEqual(["confirmacion_turno_v1", "confirmacion_turno_v2"]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([
      { version: 2, metaId: "222", status: "pending", body: `${body}. Gracias.` },
      { version: 1, metaId: "111", status: "pending", body, rejectionReason: null },
    ]);
  });

  it("submits past a version Meta already has, though nothing here stored it", async () => {
    // A submission whose answer was lost, or another Worker on the same account.
    fakeMeta.templatesAtMeta = [
      "confirmacion_turno_v1",
      "confirmacion_turno_v3",
      "confirmacion_turno_extra_v9",
      "recordatorio_turno_v7",
    ];
    fakeMeta.answerWith(200, metaCreated("777"));

    expectOk(await organization.submitWhatsappTemplate(adminCaller, confirmation));

    expect(createdAtMeta()).toEqual(["confirmacion_turno_v4"]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ version: 4, metaId: "777" }]);
  });

  it("reads every page Meta lists before choosing the version", async () => {
    fakeMeta.templatesPerPage = 2;
    fakeMeta.templatesAtMeta = [
      "recordatorio_turno_v1",
      "recordatorio_turno_sin_confirmacion_v1",
      "recordatorio_turno_sin_confirmacion_v2",
      "recordatorio_turno_v5",
    ];
    fakeMeta.answerWith(200, metaCreated("888"));

    expectOk(
      await organization.submitWhatsappTemplate(adminCaller, {
        templateName: "recordatorio_turno",
        body,
      }),
    );

    expect(createdAtMeta()).toEqual(["recordatorio_turno_v6"]);
  });

  it("keeps the status Meta answers with when it decides at once", async () => {
    fakeMeta.answerWith(200, metaCreated("333", "APPROVED"));

    expectOk(await organization.submitWhatsappTemplate(adminCaller, confirmation));

    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ status: "approved" }]);
  });

  it("refuses a body that fails the rules check with what to fix, and submits nothing", async () => {
    const answer = await organization.submitWhatsappTemplate(adminCaller, {
      templateName: "confirmacion_turno",
      body: "{{paciente}}, tu turno es el {{Fecha}}",
    });

    expect(answer).toEqual({
      ok: false,
      reason: "invalidTemplate",
      problems: [
        { kind: "startsWithVariable" },
        { kind: "endsWithVariable" },
        { kind: "uppercaseVariable", variable: "Fecha" },
      ],
    });
    expect(fakeMeta.requests).toEqual([]);
    expect(await versionsOf("confirmacion_turno")).toEqual([]);
  });

  it("refuses a second submission of a template while Meta still answers the first", async () => {
    fakeMeta.answerWith(200, metaCreated("666"));
    const release = fakeMeta.holdNext();

    const first = organization.submitWhatsappTemplate(adminCaller, confirmation);
    await fakeMeta.received(1);
    const second = await organization.submitWhatsappTemplate(adminCaller, confirmation);
    release();

    expect(second).toEqual({ ok: false, reason: "alreadySubmitting" });
    expectOk(await first);
    expect(createdAtMeta()).toEqual(["confirmacion_turno_v1"]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ version: 1, metaId: "666" }]);
  });

  it("answers Meta's refusal with Meta's message, and stores nothing", async () => {
    fakeMeta.answerWith(400, {
      error: { message: "Invalid parameter", code: 100, error_subcode: 2388024 },
    });

    const answer = await organization.submitWhatsappTemplate(adminCaller, confirmation);

    expect(answer).toEqual({
      ok: false,
      reason: "metaRefused",
      metaError: { code: 100, message: "Invalid parameter" },
    });
    expect(await versionsOf("confirmacion_turno")).toEqual([]);
  });

  it("is disabled, and says which setting is missing, without the business account id", async () => {
    delete fakeMeta.settings.WHATSAPP_BUSINESS_ACCOUNT_ID;

    const answer = await organization.submitWhatsappTemplate(adminCaller, confirmation);
    const listed = expectOk(await organization.whatsappSettings(adminCaller));

    expect(answer).toEqual({ ok: false, reason: "missingBusinessAccountId" });
    expect(listed.templateMissing).toBe("missingBusinessAccountId");
    expect(fakeMeta.requests).toEqual([]);
  });

  it("records each submission in the audit log, with Meta's id and status", async () => {
    fakeMeta.answerWith(200, metaCreated("444"));

    const submitted = expectOk(
      await organization.submitWhatsappTemplate(adminCaller, confirmation),
    );

    expect(await auditEntriesFor(organization, submitted.template.id)).toMatchObject([
      {
        action: "create",
        entityType: "whatsappTemplate",
        userId: adminCaller.userId,
        after: expect.objectContaining({
          name: "confirmacion_turno",
          version: 1,
          metaId: "444",
          status: "pending",
        }),
      },
    ]);
  });

  it("is refused to anyone but a signed-in admin, as is the list", async () => {
    const callers = [
      await addMember(organization, ["receptionist"]),
      await addMember(organization, ["practitioner"]),
      { userId: "user-stranger" },
      await addRefusedAdmin(organization, "deactivated"),
      await addRefusedAdmin(organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.flatMap((caller) => [
        organization.submitWhatsappTemplate(caller, confirmation),
        organization.whatsappSettings(caller),
        organization.refreshWhatsappTemplates(caller),
      ]),
    );

    expect(answers.map((answer) => (answer.ok ? "done" : answer.reason))).toEqual([
      ...["forbidden", "forbidden", "forbidden"],
      ...["forbidden", "forbidden", "forbidden"],
      ...["unauthenticated", "unauthenticated", "unauthenticated"],
      ...["unauthenticated", "unauthenticated", "unauthenticated"],
      ...["mustChangePassword", "mustChangePassword", "mustChangePassword"],
    ]);
    expect(fakeMeta.requests).toEqual([]);
  });
});

describe("a template's status", () => {
  beforeEach(async () => {
    fakeMeta.answerWith(200, metaCreated("555"));
    expectOk(await organization.submitWhatsappTemplate(adminCaller, confirmation));
  });

  it("moves to approved on Meta's status event for its id", async () => {
    const stored = expectOk(await organization.storeWhatsappEvents(statusEvent("555", "approved")));

    expect(stored.templateStatuses).toEqual([{ metaId: "555", updated: true }]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([
      { status: "approved", rejectionReason: null },
    ]);
  });

  it("moves to rejected with Meta's reason", async () => {
    await organization.storeWhatsappEvents(statusEvent("555", "rejected", "INVALID_FORMAT"));

    expect(await versionsOf("confirmacion_turno")).toMatchObject([
      { status: "rejected", rejectionReason: "INVALID_FORMAT" },
    ]);
  });

  it("ignores an event for an id no template has", async () => {
    const stored = expectOk(await organization.storeWhatsappEvents(statusEvent("999", "approved")));

    expect(stored.templateStatuses).toEqual([{ metaId: "999", updated: false }]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ status: "pending" }]);
  });

  it("is read again from Meta for every template on a refresh", async () => {
    fakeMeta.requests = [];
    fakeMeta.answerWith(200, {
      id: "555",
      status: "REJECTED",
      rejected_reason: "TAG_CONTENT_MISMATCH",
    });

    const refreshed = expectOk(await organization.refreshWhatsappTemplates(adminCaller));

    expect(refreshed.failures).toEqual([]);
    expect(fakeMeta.requests).toEqual([
      {
        method: "GET",
        url: "https://graph.facebook.com/v26.0/555?fields=status%2Crejected_reason",
        authorization: `Bearer ${metaAccessToken}`,
        body: null,
      },
    ]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([
      { status: "rejected", rejectionReason: "TAG_CONTENT_MISMATCH" },
    ]);
  });

  it("keeps a status the webhook stored while a refresh was still reading Meta", async () => {
    fakeMeta.answerWith(200, { id: "555", status: "PENDING" });
    const release = fakeMeta.holdNext();

    const refresh = organization.refreshWhatsappTemplates(adminCaller);
    // The submission made two requests: the list of names, and the create.
    await fakeMeta.received(3);
    await organization.storeWhatsappEvents(statusEvent("555", "approved"));
    release();
    expectOk(await refresh);

    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ status: "approved" }]);
  });

  it("keeps a status the webhook changed and changed back while a refresh was reading Meta", async () => {
    fakeMeta.answerWith(200, { id: "555", status: "PAUSED" });
    const release = fakeMeta.holdNext();

    const refresh = organization.refreshWhatsappTemplates(adminCaller);
    await fakeMeta.received(3);
    await organization.storeWhatsappEvents(statusEvent("555", "approved"));
    await organization.storeWhatsappEvents(statusEvent("555", "pending"));
    release();
    expectOk(await refresh);

    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ status: "pending" }]);
  });

  it("keeps a template's status, and reports Meta's refusal, when a refresh cannot read it", async () => {
    fakeMeta.answerWith(400, { error: { message: "Unsupported get request", code: 100 } });

    const refreshed = expectOk(await organization.refreshWhatsappTemplates(adminCaller));

    expect(refreshed.failures).toEqual([{ code: 100, message: "Unsupported get request" }]);
    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ status: "pending" }]);
  });
});

describe("a template's versions", () => {
  /** Submits `count` versions of the confirmation, `1` up, Meta's ids `v1`, `v2`… */
  async function submitVersions(count: number) {
    for (let version = 1; version <= count; version += 1) {
      fakeMeta.answerNextWith(200, metaCreated(`v${version}`));
      expectOk(
        await organization.submitWhatsappTemplate(adminCaller, {
          ...confirmation,
          body: `${body} (${version})`,
        }),
      );
    }
  }

  it("are listed newest first, each with its body, its status and Meta's reason for a rejection", async () => {
    await submitVersions(3);
    await organization.storeWhatsappEvents(statusEvent("v1", "approved"));
    await organization.storeWhatsappEvents(statusEvent("v2", "rejected", "INVALID_FORMAT"));

    expect(await versionsOf("confirmacion_turno")).toMatchObject([
      { version: 3, body: `${body} (3)`, status: "pending", rejectionReason: null },
      { version: 2, body: `${body} (2)`, status: "rejected", rejectionReason: "INVALID_FORMAT" },
      { version: 1, body: `${body} (1)`, status: "approved", rejectionReason: null },
    ]);
  });

  it("mark the latest approved utility one as the one in use, and only it", async () => {
    await submitVersions(4);
    await organization.storeWhatsappEvents(statusEvent("v1", "approved"));
    await organization.storeWhatsappEvents(statusEvent("v2", "approved"));
    await organization.storeWhatsappEvents(statusEvent("v3", "approved"));
    // Meta moved v3 to marketing, which no longer goes.
    await organization.storeWhatsappEvents({
      ...statusEvent("v3", "approved"),
      templateStatuses: [],
      templateCategories: [{ metaId: "v3", category: "MARKETING" }],
    });

    const versions = await versionsOf("confirmacion_turno");

    expect(versions.map(({ version, inUse }) => ({ version, inUse }))).toEqual([
      { version: 4, inUse: false },
      { version: 3, inUse: false },
      { version: 2, inUse: true },
      { version: 1, inUse: false },
    ]);
  });

  it("have none in use while none is approved", async () => {
    await submitVersions(1);

    expect(await versionsOf("confirmacion_turno")).toMatchObject([{ inUse: false }]);
  });
});
