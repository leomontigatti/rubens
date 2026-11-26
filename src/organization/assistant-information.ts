import { bookable, offering } from "#/organization/booking-times.ts";
import type { Database } from "#/organization/database.ts";

// What the patient assistant tells about the practice (docs/domain/assistant.md
// § For patients), from the organization's data only: no price, no insurer.

/**
 * The medical services patients can book by WhatsApp, by name, each with the
 * practitioners who offer it by the name patients read: those
 * find_booking_times offers times of.
 */
export function bookableMedicalServices(database: Database) {
  const byName = new Map<string, string[]>();
  for (const row of offering(database, undefined).filter(bookable)) {
    byName.set(row.name, [...new Set([...(byName.get(row.name) ?? []), row.practitioner])]);
  }
  return [...byName].map(([name, practitioners]) => ({ name, practitioners }));
}
