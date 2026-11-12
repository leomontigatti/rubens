import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MedicalServiceInput, MedicalServiceUpdate } from "#/lib/medical-services.ts";

import {
  addStaff,
  adminCaller,
  auditEntriesFor,
  expectOk,
  fakeMeta,
  inStorage,
  setUpTestOrganization,
  submitTemplate,
} from "#/organization/organization.test-support.ts";
import { member } from "#/organization/schema.ts";

// Meta answers the template submission the care instructions are measured against.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

beforeEach(() => {
  fakeMeta.reset();
});

/** A medical service's patient messages, none picked: an edit names every one. */
const noMessages = { templateIds: [], rescheduleCutoffHours: 24 };

async function world() {
  const { organization } = await setUpTestOrganization();
  const juan = await addStaff(organization, "Juan Gómez");
  const ana = await addStaff(organization, "Ana Ruiz");
  const rita = await addStaff(organization, "Rita Paz", ["receptionist"]);
  const firstVisit = (overrides: Partial<MedicalServiceInput> = {}): MedicalServiceInput => ({
    practitionerId: juan.practitionerId,
    name: "Primera consulta",
    durationMinutes: 40,
    ...overrides,
  });
  async function created(caller: typeof adminCaller = adminCaller, input = firstVisit()) {
    const result = await organization.createMedicalService(caller, input);
    if (!result.ok) {
      throw new Error(`createMedicalService refused: ${result.reason}`);
    }
    return result.medicalService;
  }
  async function servicesOf(
    caller: typeof adminCaller,
    includeInactive: boolean,
    id = juan.practitionerId,
  ) {
    const result = await organization.listMedicalServices(caller, {
      practitionerId: id,
      includeInactive,
    });
    if (!result.ok) {
      throw new Error(`listMedicalServices refused: ${result.reason}`);
    }
    return result;
  }
  return { organization, juan, ana, rita, firstVisit, created, servicesOf };
}

describe("managing medical services", () => {
  it("lists the practising practitioners by name", async () => {
    const { organization, juan, ana } = await world();

    expect(await organization.listSchedulePractitioners(adminCaller)).toEqual({
      ok: true,
      practitioners: [
        { id: ana.practitionerId, displayName: "Ana Ruiz" },
        { id: juan.practitionerId, displayName: "Juan Gómez" },
      ],
    });
  });

  it("lets an admin create and edit a practitioner's medical services, listed by name", async () => {
    const { organization, rita, firstVisit, created, servicesOf } = await world();
    const first = await created();
    await created(adminCaller, firstVisit({ name: "Control", durationMinutes: 20 }));

    const edited = await organization.updateMedicalService(adminCaller, {
      medicalServiceId: first.id,
      ...noMessages,
      name: "Primera vez",
      durationMinutes: 45,
    });

    expect(edited).toMatchObject({
      ok: true,
      medicalService: { name: "Primera vez", durationMinutes: 45, active: true },
    });
    const { medicalServices } = await servicesOf(rita.caller, false);
    expect(medicalServices.map((service) => service.name)).toEqual(["Control", "Primera vez"]);
  });

  it("lets a practitioner manage their own medical services and no one else's", async () => {
    const { organization, juan, ana, firstVisit, created, servicesOf } = await world();
    const own = await organization.createMedicalService(juan.caller, firstVisit());
    const others = await organization.createMedicalService(
      juan.caller,
      firstVisit({ practitionerId: ana.practitionerId }),
    );
    const othersService = await created(
      adminCaller,
      firstVisit({ practitionerId: ana.practitionerId }),
    );

    expect(own.ok).toBe(true);
    expect(others).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await organization.updateMedicalService(juan.caller, {
        medicalServiceId: othersService.id,
        ...noMessages,
        name: "Otro",
        durationMinutes: 30,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await organization.setMedicalServiceActive(juan.caller, {
        id: othersService.id,
        active: false,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect((await servicesOf(juan.caller, true)).canEdit).toBe(true);
    expect((await servicesOf(juan.caller, true, ana.practitionerId)).canEdit).toBe(false);
  });

  it("refuses a receptionist's changes, with a structured result", async () => {
    const { organization, rita, firstVisit, created, servicesOf } = await world();
    const service = await created();

    expect(await organization.createMedicalService(rita.caller, firstVisit())).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await organization.setMedicalServiceActive(rita.caller, { id: service.id, active: false }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect((await servicesOf(rita.caller, true)).canEdit).toBe(false);
  });

  it("saves the longest duration, which the database's check allows too", async () => {
    const { firstVisit, created } = await world();

    expect((await created(adminCaller, firstVisit({ durationMinutes: 720 }))).durationMinutes).toBe(
      720,
    );
  });

  it("refuses a medical service for an unknown or deactivated practitioner", async () => {
    const { organization, firstVisit } = await world();
    const pedro = await addStaff(organization, "Pedro Sosa");
    await inStorage(organization, (database) =>
      database
        .update(member)
        .set({ active: false })
        .where(eq(member.userId, pedro.caller.userId))
        .run(),
    );

    expect(
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ practitionerId: crypto.randomUUID() }),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ practitionerId: pedro.practitionerId }),
      ),
    ).toEqual({ ok: false, reason: "practitionerInactive" });
  });
});

describe("deactivating a medical service", () => {
  it("drops it from the booking list and keeps it on the medical services screen", async () => {
    const { organization, rita, created, servicesOf } = await world();
    const service = await created();

    const result = await organization.setMedicalServiceActive(adminCaller, {
      id: service.id,
      active: false,
    });

    expect(result).toEqual({ ok: true });
    expect((await servicesOf(rita.caller, false)).medicalServices).toEqual([]);
    expect((await servicesOf(adminCaller, true)).medicalServices).toMatchObject([
      { id: service.id, active: false },
    ]);
  });

  it("brings it back on reactivation", async () => {
    const { organization, rita, created, servicesOf } = await world();
    const service = await created();
    await organization.setMedicalServiceActive(adminCaller, { id: service.id, active: false });
    await organization.setMedicalServiceActive(adminCaller, { id: service.id, active: true });

    expect((await servicesOf(rita.caller, false)).medicalServices).toMatchObject([
      { id: service.id, active: true },
    ]);
  });
});

describe("auditing medical services", () => {
  it("records the creation, each edit and the deactivation", async () => {
    const { organization, juan, firstVisit, created } = await world();
    const service = await created(juan.caller);
    await organization.updateMedicalService(adminCaller, {
      medicalServiceId: service.id,
      ...noMessages,
      name: "Primera consulta",
      durationMinutes: 60,
    });
    await organization.setMedicalServiceActive(adminCaller, { id: service.id, active: false });

    const about = { entityType: "medicalService", patientId: null };
    expect(await auditEntriesFor(organization, service.id)).toEqual([
      {
        ...about,
        action: "create",
        userId: juan.caller.userId,
        before: null,
        after: { ...firstVisit(), templateIds: "[]", rescheduleCutoffHours: 24 },
      },
      {
        ...about,
        action: "update",
        userId: adminCaller.userId,
        before: { durationMinutes: 40 },
        after: { durationMinutes: 60 },
      },
      {
        ...about,
        action: "deactivate",
        userId: adminCaller.userId,
        before: { active: true },
        after: { active: false },
      },
    ]);
  });
});

describe("the templates a medical service sends", () => {
  /** The organization's drafts a medical service can pick, by name. */
  async function drafts(servicesOf: Awaited<ReturnType<typeof world>>["servicesOf"]) {
    const { templates } = await servicesOf(adminCaller, false);
    return Object.fromEntries(templates.map((one) => [one.name, one.id]));
  }

  it("starts with none and a 24-hour cutoff, and offers the organization's own templates in the order they go", async () => {
    const { created, servicesOf } = await world();

    expect(await created()).toMatchObject({ templateIds: [], rescheduleCutoffHours: 24 });
    expect((await servicesOf(adminCaller, false)).templates).toEqual([
      {
        id: expect.any(String),
        name: "Confirmación del turno",
        timing: { when: "booking" },
        approved: false,
      },
      {
        id: expect.any(String),
        name: "Recordatorio con confirmación",
        timing: { when: "before", hours: 24 },
        approved: false,
      },
      {
        id: expect.any(String),
        name: "Recordatorio",
        timing: { when: "before", hours: 2 },
        approved: false,
      },
      {
        id: expect.any(String),
        name: "Seguimiento",
        timing: { when: "after", hours: 24 },
        approved: false,
      },
    ]);
  });

  it("says which templates Meta approved, the ones ready to send", async () => {
    const { organization, servicesOf } = await world();
    const ids = await drafts(servicesOf);

    await submitTemplate(organization, ids["Recordatorio"]!, {
      status: "APPROVED",
      metaId: "900000000000041",
    });
    await submitTemplate(organization, ids["Seguimiento"]!, {
      status: "PENDING",
      metaId: "900000000000042",
    });

    const { templates } = await servicesOf(adminCaller, false);
    expect(templates.filter((one) => one.approved).map((one) => one.name)).toEqual([
      "Recordatorio",
    ]);
  });

  it("refuses more than five reminders, on a create and an edit", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const ids = await drafts(servicesOf);
    const added: string[] = [];
    for (const hours of [4, 6, 8, 48]) {
      fakeMeta.answerNextWith(200, { id: `9000000000005${hours}`, status: "PENDING" });
      const result = expectOk(
        await organization.createTemplate(adminCaller, {
          name: `Recordatorio ${hours} horas`,
          timing: { when: "before", hours },
          body: "Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}}. Consultorios Prueba",
        }),
      );
      added.push(result.templateId);
    }
    const reminders = [ids["Recordatorio"]!, ids["Recordatorio con confirmación"]!, ...added];
    const five = [...reminders.slice(0, 5), ids["Seguimiento"]!];
    const service = await created(adminCaller, firstVisit({ templateIds: five }));

    const answers = [
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ name: "Control", templateIds: reminders }),
      ),
      await organization.updateMedicalService(adminCaller, {
        ...firstVisit(),
        templateIds: reminders,
        rescheduleCutoffHours: 24,
        medicalServiceId: service.id,
      }),
    ];

    expect(answers.map((answer) => (answer.ok ? "saved" : answer.reason))).toEqual([
      "tooManyReminders",
      "tooManyReminders",
    ]);
    expect((await servicesOf(adminCaller, false)).medicalServices).toMatchObject([
      { templateIds: expect.arrayContaining(five) },
    ]);
  });

  it("saves and returns the templates it picks, each once, several sharing a timing", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const ids = await drafts(servicesOf);
    const service = await created();
    const picked = [ids["Recordatorio"]!, ids["Seguimiento"]!, ids["Recordatorio"]!];

    expectOk(
      await organization.updateMedicalService(adminCaller, {
        ...firstVisit(),
        templateIds: picked,
        rescheduleCutoffHours: 12,
        medicalServiceId: service.id,
      }),
    );

    const [saved] = (await servicesOf(adminCaller, false)).medicalServices;
    expect(saved!.templateIds).toHaveLength(2);
    expect(saved!.templateIds).toEqual(
      expect.arrayContaining([ids["Recordatorio"], ids["Seguimiento"]]),
    );
    expect(saved!.rescheduleCutoffHours).toBe(12);
  });

  it("refuses an event template, and one no organization template is", async () => {
    const { organization, firstVisit } = await world();

    const answers = [
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ templateIds: [crypto.randomUUID()] }),
      ),
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ templateIds: ["turno_movido"] }),
      ),
    ];

    expect(answers.map((answer) => (answer.ok ? "saved" : answer.reason))).toEqual([
      "unknownTemplate",
      "invalidInput",
    ]);
  });

  it("refuses an edit that leaves its templates out, rather than clearing them", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const ids = await drafts(servicesOf);
    const service = await created(adminCaller, firstVisit({ templateIds: [ids["Seguimiento"]!] }));

    // The shape of an edit form opened before medical services picked templates.
    expect(
      await organization.updateMedicalService(adminCaller, {
        name: "Primera vez",
        durationMinutes: 40,
        medicalServiceId: service.id,
      } as MedicalServiceUpdate),
    ).toEqual({ ok: false, reason: "invalidInput" });
    expect((await servicesOf(adminCaller, false)).medicalServices).toMatchObject([
      { name: "Primera consulta", templateIds: [ids["Seguimiento"]] },
    ]);
  });

  it("audits a change to its templates", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const ids = await drafts(servicesOf);
    const service = await created();

    await organization.updateMedicalService(adminCaller, {
      ...firstVisit(),
      templateIds: [ids["Seguimiento"]!],
      rescheduleCutoffHours: 24,
      medicalServiceId: service.id,
    });

    const [, update] = await auditEntriesFor(organization, service.id);
    expect(update).toMatchObject({
      action: "update",
      before: { templateIds: "[]" },
      after: { templateIds: JSON.stringify([ids["Seguimiento"]]) },
    });
  });
});
