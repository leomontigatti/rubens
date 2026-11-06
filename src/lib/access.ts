/** The roles a member holds, in any combination (GLOSSARY.md). */
export const roleNames = ["admin", "receptionist", "practitioner"] as const;

export type Role = (typeof roleNames)[number];

/** The roles in a `member.role` value; unknown names are dropped. */
export function parseRoles(value: string): Role[] {
  const names = value.split(",").map((name) => name.trim());
  return roleNames.filter((role) => names.includes(role));
}

/**
 * Whether the roles act for every practitioner, not only themselves: an admin
 * or reception books for, and sees the appointments and free times of, anyone.
 */
export function actsForEveryone(actor: { roles: readonly Role[] }): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("receptionist");
}
