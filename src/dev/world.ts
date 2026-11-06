import type { Role } from "#/lib/access.ts";

// The organization the dev sign-in signs into, made-up data only: what a fresh
// clone's `pnpm dev` shows and what the browser suite drives
// (`tests/e2e/world.test-support.ts`). Each area of the port (#131) adds its
// rows here and to `seedDevOrganization` (`src/dev/seed.ts`).

export const devOrganizationName = "Consultorios Prueba";

export const devRoles = [
  "admin",
  "receptionist",
  "practitioner",
] as const satisfies readonly Role[];

export type DevRole = (typeof devRoles)[number];

/** One member per role, each holding that role alone. */
export const devPeople: Record<DevRole, { userId: string; name: string; email: string }> = {
  admin: { userId: "dev-admin", name: "Ana Prueba", email: "ana@prueba.example.com" },
  receptionist: {
    userId: "dev-receptionist",
    name: "Rita Prueba",
    email: "rita@prueba.example.com",
  },
  practitioner: {
    userId: "dev-practitioner",
    name: "Juan Prueba",
    email: "juan@prueba.example.com",
  },
};

/** The one office, its room, and the practitioner's medical service. */
export const devOffice = { name: "Sede E2E", address: "Av. Colón 100" };
export const devRoom = { name: "Consultorio E2E" };
export const devMedicalService = { name: "Consulta E2E", durationMinutes: 30 };

/**
 * Patients already registered: two for the form-page races, which need two
 * records of the same edit page, and the ones the search race types for.
 */
export const devPatients = [
  { firstName: "Marta", lastName: "Quiroga", phone: "0351 15 400-0001" },
  { firstName: "Nicolás", lastName: "Ferreyra", phone: "0351 15 400-0002" },
  { firstName: "Olga", lastName: "Benítez", phone: "0351 15 400-0003" },
  { firstName: "Osvaldo", lastName: "Bustos", phone: "0351 15 400-0004" },
] as const;

/**
 * The practitioner works every day from 08:00 to 20:00 in the room, from the
 * day the seed runs on, so any later day has free starts.
 */
export const workingHours = { startTime: "08:00", endTime: "20:00" } as const;
