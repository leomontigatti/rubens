import { defaultTimeZone } from "#/lib/offices.ts";
import { parsePhone } from "#/lib/phones.ts";
import { today } from "#/lib/schedules.ts";

import type { Organization } from "#/organization/organization.ts";

import { accepted } from "#/dev/accepted.ts";
import { seedQaData } from "#/dev/qa-seed.ts";

import {
  devIncomingMessages,
  devMedicalService,
  devOffice,
  devOrganizationName,
  devPatients,
  devPeople,
  devRoom,
  workingHours,
} from "#/dev/world.ts";

/**
 * Fills a new dev organization's object with `src/dev/world.ts`, through the
 * object's own methods, so the seed obeys the rules a screen does; with `qa`,
 * which only `pnpm dev` passes, `src/dev/qa-world.ts` too. An object already
 * set up is left as it is: two first page loads at once seed it once.
 */
export async function seedDevOrganization(
  organization: DurableObjectStub<Organization>,
  organizationId: string,
  options: { qa: boolean } = { qa: false },
): Promise<void> {
  const setUp = await organization.setUp({
    organizationId,
    name: devOrganizationName,
    admin: devPeople.admin,
  });
  if (!setUp.ok) {
    if (setUp.reason === "alreadySetUp") {
      return;
    }
    throw new Error(`dev seed: setUp refused (${setUp.reason})`);
  }
  const admin = { userId: devPeople.admin.userId };
  for (const role of ["receptionist", "practitioner"] as const) {
    accepted(
      `addMember ${role}`,
      await organization.addMember(admin, { ...devPeople[role], roles: [role] }),
    );
  }
  const office = accepted("createOffice", await organization.createOffice(admin, devOffice));
  const { room } = accepted(
    "createRoom",
    await organization.createRoom(admin, { ...devRoom, officeId: office.office.id }),
  );
  const [practitioner] = accepted(
    "listSchedulePractitioners",
    await organization.listSchedulePractitioners(admin),
  ).practitioners;
  if (!practitioner) {
    throw new Error("dev seed: no practitioner to give a medical service");
  }
  // The medical service sends every draft the migration gave the organization.
  const { templates } = accepted(
    "listMedicalServices",
    await organization.listMedicalServices(admin, {
      practitionerId: practitioner.id,
      includeInactive: false,
    }),
  );
  const { medicalService } = accepted(
    "createMedicalService",
    await organization.createMedicalService(admin, {
      ...devMedicalService,
      practitionerId: practitioner.id,
      templateIds: templates.map((one) => one.id),
    }),
  );
  const devPatientIds: string[] = [];
  for (const patient of devPatients) {
    const registered = accepted(
      `registerPatient ${patient.lastName}`,
      await organization.registerPatient(admin, patient),
    );
    devPatientIds.push(registered.patient.id);
  }
  accepted(
    "createSchedule",
    await organization.createSchedule(admin, {
      ...workingHours,
      practitionerId: practitioner.id,
      roomId: room.id,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      firstDate: today(defaultTimeZone),
      lastDate: null,
    }),
  );
  accepted(
    "storeWhatsappEvents",
    await organization.storeWhatsappEvents({
      messages: devIncomingMessages.map((message, index) => ({
        whatsappId: `wamid.dev-${index}`,
        from: accepted("parsePhone", parsePhone(message.from)).phone,
        sentAt: Date.now() - message.minutesAgo * 60_000,
        type: "text",
        text: message.text,
        payload: "{}",
      })),
      statuses: [],
      templateStatuses: [],
    }),
  );
  // A restriction Meta has since lifted: the admin's warning stays, and nothing is held.
  accepted(
    "storeWhatsappEvents restriction",
    await organization.storeWhatsappEvents({
      messages: [],
      statuses: [],
      templateStatuses: [],
      numberEvents: [
        { kind: "restricted", until: Date.now() + 24 * 60 * 60_000 },
        { kind: "unrestricted" },
      ],
    }),
  );
  if (options.qa) {
    await seedQaData(organization, {
      admin,
      officeId: office.office.id,
      juanId: practitioner.id,
      devConsultId: medicalService.id,
      devPatientIds,
    });
  }
}
