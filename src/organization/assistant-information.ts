import { and, asc, eq } from "drizzle-orm";

import type { Database } from "#/organization/database.ts";
import { medicalService, member, practitioner } from "#/organization/schema.ts";

// What the patient assistant tells about the practice (docs/domain/assistant.md
// § For patients), from the organization's data only: no price, no insurer.

/**
 * The medical services patients can book by WhatsApp, by name, each with the
 * practitioners who offer it by the name patients read: active ones with the
 * switch on, of an active practitioner.
 */
export function bookableMedicalServices(database: Database) {
  const rows = database
    .select({ name: medicalService.name, practitioner: practitioner.displayName })
    .from(medicalService)
    .innerJoin(practitioner, eq(practitioner.id, medicalService.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(
      and(
        eq(medicalService.active, true),
        eq(medicalService.whatsappBooking, true),
        eq(member.active, true),
      ),
    )
    .orderBy(asc(medicalService.name), asc(practitioner.displayName))
    .all();
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    byName.set(row.name, [...new Set([...(byName.get(row.name) ?? []), row.practitioner])]);
  }
  return [...byName].map(([name, practitioners]) => ({ name, practitioners }));
}
