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

/** A medical service's patient messages, all unset: an edit names every one. */
const noMessages = {
  reminders: [],
  careInstructions: null,
  followUpHours: null,
  rescheduleCutoffHours: 24,
};

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

  it("sends the booking confirmation unless the medical service is set not to", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const first = await created();
    await created(adminCaller, firstVisit({ name: "Control", bookingConfirmation: false }));

    await organization.updateMedicalService(adminCaller, {
      medicalServiceId: first.id,
      ...noMessages,
      name: "Primera consulta",
      durationMinutes: 40,
      bookingConfirmation: false,
    });

    const { medicalServices } = await servicesOf(adminCaller, false);
    expect(
      medicalServices.map(({ name, bookingConfirmation }) => [name, bookingConfirmation]),
    ).toEqual([
      ["Control", false],
      ["Primera consulta", false],
    ]);
    expect(first.bookingConfirmation).toBe(true);
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
      bookingConfirmation: false,
    });
    await organization.setMedicalServiceActive(adminCaller, { id: service.id, active: false });

    const about = { entityType: "medicalService", patientId: null };
    expect(await auditEntriesFor(organization, service.id)).toEqual([
      {
        ...about,
        action: "create",
        userId: juan.caller.userId,
        before: null,
        after: {
          ...firstVisit(),
          bookingConfirmation: true,
          reminders: "[]",
          rescheduleCutoffHours: 24,
        },
      },
      {
        ...about,
        action: "update",
        userId: adminCaller.userId,
        before: { durationMinutes: 40, bookingConfirmation: true },
        after: { durationMinutes: 60, bookingConfirmation: false },
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

describe("a medical service's patient messages", () => {
  const messages = {
    reminders: [
      { hoursBefore: 2, asksToConfirm: false },
      { hoursBefore: 48, asksToConfirm: true },
    ],
    careInstructions: "No comer 2 horas antes.\nTraer estudios previos.",
    followUpHours: 72,
    rescheduleCutoffHours: 12,
  };

  it("starts with no reminders, care instructions or follow-up, and a 24-hour cutoff", async () => {
    const { created } = await world();

    expect(await created()).toMatchObject({
      reminders: [],
      careInstructions: null,
      followUpHours: null,
      rescheduleCutoffHours: 24,
    });
  });

  it("saves and returns its reminders, latest first, care instructions, follow-up and cutoff", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const service = await created(adminCaller, firstVisit(messages));

    const expected = {
      reminders: [
        { hoursBefore: 48, asksToConfirm: true },
        { hoursBefore: 2, asksToConfirm: false },
      ],
      careInstructions: messages.careInstructions,
      followUpHours: 72,
      rescheduleCutoffHours: 12,
    };
    expect(service).toMatchObject(expected);
    expect((await servicesOf(adminCaller, false)).medicalServices).toMatchObject([expected]);

    const edited = await organization.updateMedicalService(adminCaller, {
      ...firstVisit(),
      ...noMessages,
      medicalServiceId: service.id,
      reminders: [{ hoursBefore: 24, asksToConfirm: true }],
      careInstructions: "  ",
      followUpHours: null,
      rescheduleCutoffHours: 0,
    });

    const cleared = {
      reminders: [{ hoursBefore: 24, asksToConfirm: true }],
      careInstructions: null,
      followUpHours: null,
      rescheduleCutoffHours: 0,
    };
    expect(edited).toMatchObject({ ok: true, medicalService: cleared });
    expect((await servicesOf(adminCaller, false)).medicalServices).toMatchObject([cleared]);
  });

  it("refuses two reminders at the same time, or one after the appointment", async () => {
    const { organization, firstVisit } = await world();
    const refused = { ok: false, reason: "invalidInput" };

    for (const input of [
      {
        reminders: [
          { hoursBefore: 24, asksToConfirm: true },
          { hoursBefore: 24, asksToConfirm: false },
        ],
      },
      { reminders: [{ hoursBefore: -2, asksToConfirm: false }] },
    ]) {
      expect(await organization.createMedicalService(adminCaller, firstVisit(input))).toEqual(
        refused,
      );
    }
  });

  it("refuses care instructions that would not fit the template's body with its fixed text", async () => {
    const { organization, firstVisit } = await world();
    // The draft of `indicaciones` keeps 113 characters outside its variables.
    const fitting = "a".repeat(1024 - 113);

    expect(
      (
        await organization.createMedicalService(
          adminCaller,
          firstVisit({ careInstructions: fitting }),
        )
      ).ok,
    ).toBe(true);
    expect(
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ careInstructions: `${fitting}a` }),
      ),
    ).toEqual({ ok: false, reason: "careInstructionsTooLong", maxLength: 1024 - 113 });
  });

  it("measures care instructions against the approved template, with line breaks as sent", async () => {
    const { organization, firstVisit, servicesOf } = await world();
    const body = `Hola {{paciente}}: {{indicaciones}}. ${"x".repeat(950)}`;
    fakeMeta.answerNextWith(200, {
      id: "900000000000001",
      status: "APPROVED",
      category: "UTILITY",
    });
    expectOk(
      await organization.submitWhatsappTemplate(adminCaller, {
        templateName: "indicaciones",
        body,
      }),
    );
    const maxLength = 1024 - (body.length - "{{paciente}}{{indicaciones}}".length);
    expect((await servicesOf(adminCaller, false)).careInstructionsMaxLength).toBe(maxLength);

    // Each line break goes as `; `, one character longer.
    expect(
      await organization.createMedicalService(
        adminCaller,
        firstVisit({ careInstructions: `${"a".repeat(maxLength - 2)}\nb` }),
      ),
    ).toEqual({ ok: false, reason: "careInstructionsTooLong", maxLength });
    expect(
      (
        await organization.createMedicalService(
          adminCaller,
          firstVisit({ careInstructions: `${"a".repeat(maxLength - 3)}\nb` }),
        )
      ).ok,
    ).toBe(true);
  });

  it("keeps saved care instructions that a later template leaves less room for, until they change", async () => {
    const { organization, firstVisit, created } = await world();
    const careInstructions = "a".repeat(900);
    const service = await created(adminCaller, firstVisit({ careInstructions }));
    fakeMeta.answerNextWith(200, {
      id: "900000000000002",
      status: "APPROVED",
      category: "UTILITY",
    });
    expectOk(
      await organization.submitWhatsappTemplate(adminCaller, {
        templateName: "indicaciones",
        body: `Hola {{paciente}}: {{indicaciones}}. ${"x".repeat(200)}`,
      }),
    );
    const edit = { ...firstVisit(), ...noMessages, medicalServiceId: service.id };

    expect(
      await organization.updateMedicalService(adminCaller, {
        ...edit,
        careInstructions,
        name: "Otra",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await organization.updateMedicalService(adminCaller, {
        ...edit,
        careInstructions: `${careInstructions}b`,
      }),
    ).toMatchObject({ ok: false, reason: "careInstructionsTooLong" });
  });

  it("refuses an edit that leaves its messages out, rather than clearing them", async () => {
    const { organization, firstVisit, created, servicesOf } = await world();
    const service = await created(adminCaller, firstVisit(messages));

    // The shape of an edit form opened before medical services had messages.
    expect(
      await organization.updateMedicalService(adminCaller, {
        name: "Primera vez",
        durationMinutes: 40,
        bookingConfirmation: true,
        medicalServiceId: service.id,
      } as MedicalServiceUpdate),
    ).toEqual({ ok: false, reason: "invalidInput" });
    expect((await servicesOf(adminCaller, false)).medicalServices).toMatchObject([
      {
        name: "Primera consulta",
        followUpHours: 72,
        reminders: [{ hoursBefore: 48 }, { hoursBefore: 2 }],
      },
    ]);
  });

  it("audits a change to its messages", async () => {
    const { organization, firstVisit, created } = await world();
    const service = await created();

    await organization.updateMedicalService(adminCaller, {
      ...firstVisit(),
      ...messages,
      medicalServiceId: service.id,
    });

    const [, update] = await auditEntriesFor(organization, service.id);
    expect(update).toMatchObject({
      action: "update",
      before: {
        reminders: "[]",
        careInstructions: null,
        followUpHours: null,
        rescheduleCutoffHours: 24,
      },
      after: {
        reminders:
          '[{"hoursBefore":48,"asksToConfirm":true},{"hoursBefore":2,"asksToConfirm":false}]',
        careInstructions: messages.careInstructions,
        followUpHours: 72,
        rescheduleCutoffHours: 12,
      },
    });
  });
});
