// Ported from rubens' src/lib/access.ts: a member holds any combination of the roles.
// With Clerk they live in the membership's public metadata (`{ "roles": [...] }`), which
// the session token carries as the `roles` claim (Clerk dashboard → Sessions →
// Customize session token: `{ "roles": "{{org_membership.public_metadata.roles}}" }`).
export const roleNames = ["admin", "receptionist", "practitioner"] as const;

export type Role = (typeof roleNames)[number];

export function parseRoles(value: unknown): Role[] {
  const names = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(",").map((name) => name.trim())
      : [];
  return roleNames.filter((role) => names.includes(role));
}

/**
 * What the Worker passes on every call into an organization's object: who asks, for which
 * organization, with which roles. The Worker took them from a session token it verified;
 * the object is reachable only through the Worker's binding, so it trusts them.
 */
export interface Caller {
  userId: string;
  organizationId: string;
  roles: Role[];
}
