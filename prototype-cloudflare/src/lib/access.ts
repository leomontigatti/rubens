import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Ported from rubens' src/lib/access.ts: a member holds any combination of the
// roles, stored comma-separated in `member.role`.
export const ac = createAccessControl(defaultStatements);

export const roles = {
  admin: ac.newRole({ organization: ["update"] }),
  receptionist: ac.newRole({}),
  practitioner: ac.newRole({}),
};

export type Role = keyof typeof roles;

const roleNames = Object.keys(roles) as Role[];

export function parseRoles(value: string): Role[] {
  const names = value.split(",").map((name) => name.trim());
  return roleNames.filter((role) => names.includes(role));
}

/** What the Worker passes on every call into an organization's object: who asks, for which organization. */
export interface Caller {
  userId: string;
  organizationId: string;
}
