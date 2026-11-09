import {
  devIncomingMessages,
  devMedicalService,
  devOffice,
  devOrganizationName,
  devPatients,
  devPeople,
  devRoles,
  devRoom,
  workingHours as devWorkingHours,
} from "#/dev/world.ts";
import type { DevRole } from "#/dev/world.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today, weekdayOf } from "#/lib/schedules.ts";

// What the dev seed holds and the specs act on, made-up data only: the dev
// world (`src/dev/world.ts`), and the rows the specs expect that the seed adds
// as the port (#131) reaches their screens. The specs know the organization
// through this file and the browser alone: none of them reads storage or
// calls the auth server.

export const roles = devRoles;
export type E2eRole = DevRole;

export const organizationName = devOrganizationName;

/** Each role's person, signed in once by `auth.setup.ts`. */
export const people = devPeople;

export const officeName = devOffice.name;
export const roomName = devRoom.name;
export const medicalServiceName = devMedicalService.name;

/** Where `auth.setup.ts` saves a role's signed-in browser state. */
export const storageStateOf = (role: E2eRole) => `tests/e2e/.auth/${role}.json`;

/** Patients already registered (`src/dev/world.ts`). */
export const seededPatients = devPatients;

/** The messages patients sent that the seed stores, as Meta's webhook hands them over (`src/dev/world.ts`). */
export const seededIncomingMessages = devIncomingMessages;

/** A patient's name as the app shows it, with no chosen name. */
export const fullName = (patient: { firstName: string; lastName: string }) =>
  `${patient.firstName} ${patient.lastName}`;

/**
 * The practitioner's hours every day from the seed's day on. Each booking spec
 * keeps to its own weekday of next week, so specs running side by side never
 * book over each other.
 */
export const workingHours = devWorkingHours;

/** A local date of next week, by ISO weekday (1 is Monday), in the office's zone. */
export function nextWeek(weekday: number): string {
  const now = today(defaultTimeZone);
  return shiftDate(now, 7 - weekdayOf(now) + weekday);
}
