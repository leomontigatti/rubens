import { defaultTimeZone } from "#/lib/offices.ts";
import { parsePhone } from "#/lib/phones.ts";
import { today } from "#/lib/schedules.ts";

import type { Organization } from "#/organization/organization.ts";

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
 * object's own methods, so the seed obeys the rules a screen does. An object
 * already set up is left as it is: two first page loads at once seed it once.
 */
export async function seedDevOrganization(
  organization: DurableObjectStub<Organization>,
  organizationId: string,
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
  accepted(
    "createMedicalService",
    await organization.createMedicalService(admin, {
      ...devMedicalService,
      practitionerId: practitioner.id,
    }),
  );
  for (const patient of devPatients) {
    accepted(
      `registerPatient ${patient.lastName}`,
      await organization.registerPatient(admin, patient),
    );
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
}

/** `result` when the object accepted the step; a refusal stops the seed. */
function accepted<T extends { ok: true } | { ok: false; reason: string }>(
  step: string,
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`dev seed: ${step} refused (${result.reason})`);
  }
  return result as Extract<T, { ok: true }>;
}
