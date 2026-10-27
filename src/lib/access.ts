import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * The organization roles, as Better Auth's access control. A member holds any
 * combination of them, stored comma-separated in `member.role`. The plugin's
 * default `owner` and `member` roles are not used: the first admin is the
 * owner (GLOSSARY.md).
 *
 * No role is granted the plugin's `member`, `invitation`, `team` or `ac`
 * permissions, but `creatorRole: "admin"` lets an admin pass every plugin
 * permission check. Staff are managed by our own services; the plugin's
 * endpoints are refused over HTTP (`handleAuthRequest` in `src/lib/auth.ts`).
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  admin: ac.newRole({ organization: ["update"] }),
  receptionist: ac.newRole({}),
  practitioner: ac.newRole({}),
};

export type Role = keyof typeof roles;

const roleNames = Object.keys(roles) as Role[];

/** The roles in a `member.role` value; unknown names are dropped. */
export function parseRoles(value: string): Role[] {
  const names = value.split(",").map((name) => name.trim());
  return roleNames.filter((role) => names.includes(role));
}

/**
 * The acting user of a request: the organization they act for, who they are,
 * and their roles. Resolved once per request (`src/server/actor.ts`) and
 * carried into every transaction by `withTenant()`.
 */
export interface Actor {
  organizationId: string;
  userId: string;
  roles: readonly Role[];
}
