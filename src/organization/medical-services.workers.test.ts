import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import type { MedicalServiceInput } from "#/lib/medical-services.ts";

import {
  addStaff,
  adminCaller,
  auditEntriesFor,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import { member } from "#/organization/schema.ts";

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
      name: "Primera consulta",
      durationMinutes: 60,
    });
    await organization.setMedicalServiceActive(adminCaller, { id: service.id, active: false });

    const about = { entityType: "medicalService", patientId: null };
    expect(await auditEntriesFor(organization, service.id)).toEqual([
      { ...about, action: "create", userId: juan.caller.userId, before: null, after: firstVisit() },
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
