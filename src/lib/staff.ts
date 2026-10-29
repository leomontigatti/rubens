import * as z from "zod";

import { parseRoles } from "#/lib/access.ts";
import type { Role } from "#/lib/access.ts";
import { practitionerColors } from "#/lib/practitioner-colors.ts";

const roleSchema = z.enum(["admin", "receptionist", "practitioner"] satisfies Role[]);

/** At least one role, deduplicated and in the order `roles` declares them. */
const rolesSchema = z
  .array(roleSchema)
  .min(1)
  .transform((roles) => parseRoles(roles.join(",")));

export const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  receptionist: "Recepcionista",
  practitioner: "Profesional",
};

export function rolesLabel(roles: readonly Role[]): string {
  return roles.map((role) => roleLabels[role]).join(", ");
}

const memberId = z.string().min(1);

/**
 * A new staff member's fields, shared by the form and the services. The
 * password's length is checked where the account is created
 * (`src/server/accounts.ts`), against Better Auth's limits.
 */
export const staffInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().trim(),
  password: z.string(),
  roles: rolesSchema,
});

export const rolesChangeSchema = z.object({ memberId, roles: rolesSchema });

/** A practitioner's settings; an empty specialty is stored as none. */
export const practitionerUpdateSchema = z.object({
  memberId,
  displayName: z.string().trim().min(1).max(200),
  specialty: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null),
  keepsClinicalRecords: z.boolean(),
  /** Free times start every this many minutes, counted from local midnight. */
  gridMinutes: z.int().min(5).max(120),
  /** The colour of their appointments on the calendar. */
  color: z.enum(practitionerColors),
});

export const memberActiveChangeSchema = z.object({ memberId, active: z.boolean() });

export const startingPasswordSchema = z.object({ memberId, password: z.string() });

export type StaffInput = z.input<typeof staffInputSchema>;
export type RolesChange = z.input<typeof rolesChangeSchema>;
export type PractitionerUpdate = z.input<typeof practitionerUpdateSchema>;
export type MemberActiveChange = z.input<typeof memberActiveChangeSchema>;
export type StartingPasswordChange = z.input<typeof startingPasswordSchema>;
