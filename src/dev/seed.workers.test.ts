import { describe, expect, it } from "vite-plus/test";

import { seedDevOrganization } from "#/dev/seed.ts";
import { devPatients, devPeople } from "#/dev/world.ts";
import { qaPatients } from "#/dev/qa-world.ts";
import { expectOk, freshOrganization } from "#/organization/organization.test-support.ts";

// The dev seed runs every step through the object's methods and throws on a
// refusal, so seeding a fresh object is the test that the data obeys the rules.

const admin = { userId: devPeople.admin.userId };

describe("seedDevOrganization", () => {
  it("seeds the dev world alone without qa", async () => {
    const { organization, organizationId } = freshOrganization();
    await seedDevOrganization(organization, organizationId);
    const { total } = expectOk(await organization.listPatients(admin, { includeInactive: false }));
    expect(total).toBe(devPatients.length);
  });

  it("adds the QA world with qa: patients, conversations and appointments to reschedule", async () => {
    const { organization, organizationId } = freshOrganization();
    await seedDevOrganization(organization, organizationId, { qa: true });

    const patients = expectOk(await organization.listPatients(admin, { includeInactive: false }));
    const activeQaPatients = qaPatients.filter((patient) => !patient.inactive);
    expect(patients.total).toBe(devPatients.length + activeQaPatients.length);

    const conversations = expectOk(await organization.listConversations(admin, {}));
    expect(conversations.total).toBe(8);

    const toReschedule = expectOk(await organization.countToReschedule(admin));
    expect(toReschedule.count).toBeGreaterThan(0);

    // A rotation that cycles through a few patients leaves the rest with no appointments.
    const booked = [];
    for (const patient of patients.patients) {
      const upcoming = expectOk(await organization.countPatientUpcoming(admin, { id: patient.id }));
      if (upcoming.count > 0) {
        booked.push(patient.id);
      }
    }
    expect(booked.length).toBeGreaterThan(patients.total / 2);

    const members = await organization.activeMembers();
    expect(members.map((member) => member.name)).toContain("Laura Prueba");
  });
});
