import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  appointment,
  medicalService,
  auditLog,
  closure,
  coverage,
  guardian,
  insurer,
  member,
  office,
  patient,
  practitioner,
  room,
  schedule,
  timeOff,
  user,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";

import { asAppRole, createTestDatabase, rowsOf } from "./harness.ts";
import type { TestDatabase } from "./harness.ts";

// ADR-0002: row-level security is the tenant boundary. Each tenant table gets
// rows for two organizations; the app role, under one organization's settings,
// reaches only that organization's rows.

let client: PGlite;
let db: TestDatabase;

const actorA: Actor = { organizationId: "org-a", userId: "user-a", roles: ["admin"] };
const actorB: Actor = { organizationId: "org-b", userId: "user-b", roles: ["admin"] };

// Better Auth's tables carry `organization_id` but are not tenant-owned: Better
// Auth reads them before any tenant is known (PRD #16).
const betterAuthTables = ["member", "invitation"];

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  // As the owner, which bypasses row-level security.
  await db.execute(sql`
    insert into rubens.organization (id, name, slug, created_at) values
      ('org-a', 'A', 'a', now()),
      ('org-b', 'B', 'b', now())
  `);
  for (const organizationId of ["org-a", "org-b"]) {
    const [created] = await db
      .insert(office)
      .values({ organizationId, name: `Sede ${organizationId}`, address: "Calle 1" })
      .returning();
    const [createdRoom] = await db
      .insert(room)
      .values({ organizationId, officeId: created!.id, name: "Consultorio 1" })
      .returning();
    const userId = `user-${organizationId}`;
    await db.insert(user).values({ id: userId, name: "Juan", email: `${userId}@example.com` });
    await db.insert(member).values({
      id: `member-${organizationId}`,
      organizationId,
      userId,
      role: "practitioner",
      createdAt: new Date(),
    });
    const [createdPractitioner] = await db
      .insert(practitioner)
      .values({ organizationId, memberId: `member-${organizationId}`, displayName: "Juan" })
      .returning();
    await db.insert(schedule).values({
      organizationId,
      practitionerId: createdPractitioner!.id,
      roomId: createdRoom!.id,
      weekdays: [1],
      startTime: "09:00",
      endTime: "13:00",
      firstDate: "2026-01-05",
    });
    const [createdType] = await db
      .insert(medicalService)
      .values({
        organizationId,
        practitionerId: createdPractitioner!.id,
        name: "Primera consulta",
        durationMinutes: 40,
        color: "color1",
      })
      .returning();
    await db
      .insert(timeOff)
      .values({ organizationId, practitionerId: createdPractitioner!.id, during });
    await db.insert(closure).values({ organizationId, officeId: created!.id, during });
    await db.insert(closure).values({ organizationId, officeId: null, during });
    const [createdPatient] = await db
      .insert(patient)
      .values({
        organizationId,
        firstName: "Juana",
        lastName: "Paz",
        phone: "+5493515551234",
        whatsappConsentAt: new Date(),
        whatsappConsentBy: userId,
      })
      .returning();
    await db.insert(auditLog).values({
      organizationId,
      userId,
      action: "create",
      entityType: "patient",
      entityId: createdPatient!.id,
      patientId: createdPatient!.id,
    });
    const [createdInsurer] = await db
      .insert(insurer)
      .values({ organizationId, name: "OSDE", kind: "prepaga" })
      .returning();
    await db.insert(coverage).values({
      organizationId,
      patientId: createdPatient!.id,
      insurerId: createdInsurer!.id,
      memberNumber: "123",
      primary: true,
    });
    await db.insert(guardian).values({
      organizationId,
      patientId: createdPatient!.id,
      name: "Laura Paz",
      relationship: "Madre",
      phone: "+543514123456",
    });
    await db.insert(appointment).values({
      organizationId,
      patientId: createdPatient!.id,
      practitionerId: createdPractitioner!.id,
      medicalServiceId: createdType!.id,
      roomId: createdRoom!.id,
      during: appointmentDuring,
      createdBy: userId,
    });
  }
});

const appointmentDuring = {
  start: new Date("2026-01-05T12:00:00Z"),
  end: new Date("2026-01-05T12:40:00Z"),
};

const during = {
  start: new Date("2026-01-05T03:00:00Z"),
  end: new Date("2026-01-06T03:00:00Z"),
};

afterEach(async () => {
  await client.close();
});

async function officeOf(organizationId: string) {
  const rows = await db.select().from(office);
  return rows.find((row) => row.organizationId === organizationId)!;
}

describe("row-level security on tenant tables", () => {
  it("shows the app role only its own organization's offices and rooms", async () => {
    const seen = await asAppRole(db, (tx) =>
      withTenant(
        actorA,
        async (tenant) => ({
          offices: await tenant.select().from(office),
          rooms: await tenant.select().from(room),
          practitioners: await tenant.select().from(practitioner),
          schedules: await tenant.select().from(schedule),
          timeOff: await tenant.select().from(timeOff),
          closures: await tenant.select().from(closure),
          patients: await tenant.select().from(patient),
          auditLog: await tenant.select().from(auditLog),
          insurers: await tenant.select().from(insurer),
          coverages: await tenant.select().from(coverage),
          guardians: await tenant.select().from(guardian),
          medicalServices: await tenant.select().from(medicalService),
          appointments: await tenant.select().from(appointment),
        }),
        tx,
      ),
    );

    expect(seen.offices.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.rooms.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.practitioners.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.schedules.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.timeOff.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.closures.map((row) => row.organizationId)).toEqual(["org-a", "org-a"]);
    expect(seen.patients.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.auditLog.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.insurers.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.coverages.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.guardians.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.medicalServices.map((row) => row.organizationId)).toEqual(["org-a"]);
    expect(seen.appointments.map((row) => row.organizationId)).toEqual(["org-a"]);
  });

  it("shows nothing to the app role without a tenant setting", async () => {
    const counts = await asAppRole(db, async (tx) =>
      rowsOf<{
        offices: number;
        rooms: number;
        practitioners: number;
        schedules: number;
        timeOff: number;
        closures: number;
        patients: number;
        auditLog: number;
        insurers: number;
        coverages: number;
        guardians: number;
        medicalServices: number;
        appointments: number;
      }>(
        await tx.execute(sql`
          select
            (select count(*)::int from rubens.office) as offices,
            (select count(*)::int from rubens.room) as rooms,
            (select count(*)::int from rubens.practitioner) as practitioners,
            (select count(*)::int from rubens.schedule) as schedules,
            (select count(*)::int from rubens.time_off) as "timeOff",
            (select count(*)::int from rubens.closure) as closures,
            (select count(*)::int from rubens.patient) as patients,
            (select count(*)::int from rubens.audit_log) as "auditLog",
            (select count(*)::int from rubens.insurer) as insurers,
            (select count(*)::int from rubens.coverage) as coverages,
            (select count(*)::int from rubens.guardian) as guardians,
            (select count(*)::int from rubens.medical_service) as "medicalServices",
            (select count(*)::int from rubens.appointment) as appointments
        `),
      ),
    );

    expect(counts[0]).toEqual({
      offices: 0,
      rooms: 0,
      practitioners: 0,
      schedules: 0,
      timeOff: 0,
      closures: 0,
      patients: 0,
      auditLog: 0,
      insurers: 0,
      coverages: 0,
      guardians: 0,
      medicalServices: 0,
      appointments: 0,
    });
  });

  it("leaves another organization's rows unchanged by updates and deletes", async () => {
    const shifted = { start: during.end, end: new Date("2026-01-07T03:00:00Z") };
    await asAppRole(db, (tx) =>
      withTenant(
        actorA,
        async (tenant) => {
          await tenant.update(appointment).set({ receptionNote: "Cambiada" });
          await tenant.delete(appointment);
          await tenant.update(office).set({ name: "Cambiada" });
          await tenant.update(schedule).set({ startTime: "10:00" });
          await tenant.delete(schedule);
          await tenant.update(timeOff).set({ during: shifted });
          await tenant.delete(timeOff);
          await tenant.update(closure).set({ during: shifted });
          await tenant.delete(closure);
          await tenant.update(room).set({ name: "Cambiado" });
          await tenant.delete(room);
          await tenant.update(medicalService).set({ name: "Cambiado" });
          await tenant.delete(medicalService);
          await tenant.update(practitioner).set({ displayName: "Cambiado" });
          await tenant.delete(practitioner);
          await tenant.update(patient).set({ firstName: "Cambiada" });
          await tenant.update(insurer).set({ name: "Cambiada" });
          await tenant.update(coverage).set({ memberNumber: "000" });
          await tenant.delete(coverage);
          await tenant.update(guardian).set({ name: "Cambiada" });
          await tenant.delete(guardian);
        },
        tx,
      ),
    );

    const officeB = await officeOf("org-b");
    const roomsB = (await db.select().from(room)).filter((row) => row.organizationId === "org-b");
    const practitionersB = (await db.select().from(practitioner)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(officeB.name).toBe("Sede org-b");
    expect(roomsB.map((row) => row.name)).toEqual(["Consultorio 1"]);
    const schedulesB = (await db.select().from(schedule)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(practitionersB.map((row) => row.displayName)).toEqual(["Juan"]);
    expect(schedulesB.map((row) => row.startTime)).toEqual(["09:00:00"]);
    const timeOffB = (await db.select().from(timeOff)).filter(
      (row) => row.organizationId === "org-b",
    );
    const closuresB = (await db.select().from(closure)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(timeOffB.map((row) => row.during)).toEqual([during]);
    expect(closuresB.map((row) => row.during)).toEqual([during, during]);
    const patientsB = (await db.select().from(patient)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(patientsB.map((row) => row.firstName)).toEqual(["Juana"]);
    const insurersB = (await db.select().from(insurer)).filter(
      (row) => row.organizationId === "org-b",
    );
    const coveragesB = (await db.select().from(coverage)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(insurersB.map((row) => row.name)).toEqual(["OSDE"]);
    expect(coveragesB.map((row) => row.memberNumber)).toEqual(["123"]);
    const guardiansB = (await db.select().from(guardian)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(guardiansB.map((row) => row.name)).toEqual(["Laura Paz"]);
    const medicalServicesB = (await db.select().from(medicalService)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(medicalServicesB.map((row) => row.name)).toEqual(["Primera consulta"]);
    const appointmentsB = (await db.select().from(appointment)).filter(
      (row) => row.organizationId === "org-b",
    );
    expect(appointmentsB.map((row) => row.receptionNote)).toEqual([null]);
  });

  it("refuses to write a row into another organization", async () => {
    const officeB = await officeOf("org-b");

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(office).values({ organizationId: "org-b", name: "X", address: "Y" }),
          tx,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorB,
          (tenant) =>
            tenant
              .update(office)
              .set({ organizationId: "org-a" })
              .where(sql`id = ${officeB.id}`),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a room in another organization's office", async () => {
    const officeB = await officeOf("org-b");

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant
              .insert(room)
              .values({ organizationId: "org-a", officeId: officeB.id, name: "Intruso" }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a practitioner for another organization's member", async () => {
    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(practitioner).values({
              organizationId: "org-a",
              memberId: "member-org-b",
              displayName: "Intruso",
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a schedule for another organization's practitioner or room", async () => {
    const all = await db.select().from(practitioner);
    const rooms = await db.select().from(room);
    const practitionerOf = (id: string) => all.find((row) => row.organizationId === id)!.id;
    const roomOf = (id: string) => rooms.find((row) => row.organizationId === id)!.id;
    const scheduleIn = (practitionerId: string, roomId: string) =>
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(schedule).values({
              organizationId: "org-a",
              practitionerId,
              roomId,
              weekdays: [2],
              startTime: "09:00",
              endTime: "13:00",
              firstDate: "2026-01-05",
            }),
          tx,
        ),
      );

    await expect(scheduleIn(practitionerOf("org-b"), roomOf("org-a"))).rejects.toThrow();
    await expect(scheduleIn(practitionerOf("org-a"), roomOf("org-b"))).rejects.toThrow();
  });

  it("refuses time off for another organization's practitioner and a closure of its office", async () => {
    const practitionerB = (await db.select().from(practitioner)).find(
      (row) => row.organizationId === "org-b",
    )!;
    const officeB = await officeOf("org-b");
    const asA = (work: Parameters<typeof withTenant>[1]) =>
      asAppRole(db, (tx) => withTenant(actorA, work, tx));

    await expect(
      asA((tenant) =>
        tenant
          .insert(timeOff)
          .values({ organizationId: "org-a", practitionerId: practitionerB.id, during }),
      ),
    ).rejects.toThrow();
    await expect(
      asA((tenant) =>
        tenant.insert(closure).values({ organizationId: "org-a", officeId: officeB.id, during }),
      ),
    ).rejects.toThrow();
  });

  it("refuses an audit entry about another organization's patient", async () => {
    const patientB = (await db.select().from(patient)).find(
      (row) => row.organizationId === "org-b",
    )!;

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(auditLog).values({
              organizationId: "org-a",
              userId: "user-a",
              action: "update",
              entityType: "patient",
              entityId: patientB.id,
              patientId: patientB.id,
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a coverage for another organization's patient or insurer", async () => {
    const patients = await db.select().from(patient);
    const insurers = await db.select().from(insurer);
    const patientOf = (id: string) => patients.find((row) => row.organizationId === id)!.id;
    const insurerOf = (id: string) => insurers.find((row) => row.organizationId === id)!.id;
    const coverageOf = (patientId: string, insurerId: string) =>
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant
              .insert(coverage)
              .values({ organizationId: "org-a", patientId, insurerId, memberNumber: "9" }),
          tx,
        ),
      );

    await expect(coverageOf(patientOf("org-b"), insurerOf("org-a"))).rejects.toThrow();
    await expect(coverageOf(patientOf("org-a"), insurerOf("org-b"))).rejects.toThrow();
  });

  it("refuses a guardian for another organization's patient", async () => {
    const patients = await db.select().from(patient);
    const patientB = patients.find((row) => row.organizationId === "org-b")!.id;

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(guardian).values({
              organizationId: "org-a",
              patientId: patientB,
              name: "Laura",
              relationship: "Madre",
              phone: "+543514123456",
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an appointment for another organization's patient", async () => {
    const [ownA] = (await db.select().from(appointment)).filter(
      (row) => row.organizationId === "org-a",
    );
    const patientB = (await db.select().from(patient)).find(
      (row) => row.organizationId === "org-b",
    )!;

    await expect(
      asAppRole(db, (tx) =>
        withTenant(
          actorA,
          (tenant) =>
            tenant.insert(appointment).values({
              ...ownA!,
              id: undefined,
              patientId: patientB.id,
              during: { start: appointmentDuring.end, end: new Date("2026-01-05T13:00:00Z") },
            }),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("the row-level security guard", () => {
  it("finds RLS enabled, forced and with a policy on every rubens table with an organization column", async () => {
    const tables = rowsOf<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(
      await db.execute(sql`
        select
          c.relname as table_name,
          c.relrowsecurity as enabled,
          c.relforcerowsecurity as forced,
          (select count(*)::int from pg_policies p
            where p.schemaname = 'rubens' and p.tablename = c.relname) as policies
        from information_schema.columns col
        join pg_class c on c.relname = col.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = col.table_schema
        where col.table_schema = 'rubens' and col.column_name = 'organization_id'
      `),
    );
    const tenantTables = tables.filter((table) => !betterAuthTables.includes(table.table_name));

    expect(tenantTables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining([
        "office",
        "room",
        "practitioner",
        "schedule",
        "time_off",
        "closure",
        "patient",
        "audit_log",
        "insurer",
        "coverage",
        "guardian",
      ]),
    );
    expect(
      tenantTables.filter((table) => !table.enabled || !table.forced || table.policies === 0),
    ).toEqual([]);
  });
});
