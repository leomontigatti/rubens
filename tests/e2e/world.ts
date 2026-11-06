import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today, weekdayOf } from "#/lib/schedules.ts";

// What `prepare.ts` seeds and the specs act on, made-up data only. The specs
// know the organization through this file and the browser alone: none of them
// reads the database or calls the auth server.

export const roles = ["admin", "receptionist", "practitioner"] as const;
export type E2eRole = (typeof roles)[number];

export const organizationName = "Consultorios E2E";

/** Each role's person, signed in once by `auth.setup.ts`. */
export const people: Record<E2eRole, { name: string; email: string; password: string }> = {
  admin: { name: "Ana Prueba", email: "ana@e2e.example.com", password: "e2e-admin-password" },
  receptionist: {
    name: "Rita Prueba",
    email: "rita@e2e.example.com",
    password: "e2e-receptionist-password",
  },
  practitioner: {
    name: "Juan Prueba",
    email: "juan@e2e.example.com",
    password: "e2e-practitioner-password",
  },
};

export const officeName = "Sede E2E";
export const roomName = "Consultorio E2E";
export const medicalServiceName = "Consulta E2E";

/** Where `auth.setup.ts` saves a role's signed-in browser state. */
export const storageStateOf = (role: E2eRole) => `tests/e2e/.auth/${role}.json`;

/**
 * Patients already registered: two for the form-page races, which need two
 * records of the same edit page, and the ones the search race types for.
 */
export const seededPatients = [
  { firstName: "Marta", lastName: "Quiroga", phone: "0351 15 400-0001" },
  { firstName: "Nicolás", lastName: "Ferreyra", phone: "0351 15 400-0002" },
  { firstName: "Olga", lastName: "Benítez", phone: "0351 15 400-0003" },
  { firstName: "Osvaldo", lastName: "Bustos", phone: "0351 15 400-0004" },
] as const;

/**
 * The practitioner works every day from 08:00 to 20:00, from today on, so any
 * day after today has free starts. Each booking spec keeps to its own weekday
 * of next week, so specs running side by side never book over each other.
 */
export const workingHours = { startTime: "08:00", endTime: "20:00" } as const;

/** A local date of next week, by ISO weekday (1 is Monday), in the office's zone. */
export function nextWeek(weekday: number): string {
  const now = today(defaultTimeZone);
  return shiftDate(now, 7 - weekdayOf(now) + weekday);
}
