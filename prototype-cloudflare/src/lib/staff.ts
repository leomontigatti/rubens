import type { Role } from "./access";

/** The seeded staff. In dev mode these ids are the users; with Clerk the seed creates them there. */
export const staff: { devId: string; email: string; name: string; roles: Role[] }[] = [
  { devId: "user_dev_admin", email: "admin", name: "Ana Admin", roles: ["admin"] },
  { devId: "user_dev_p1", email: "p1", name: "Pablo Pérez", roles: ["practitioner"] },
  { devId: "user_dev_p2", email: "p2", name: "Paula Gómez", roles: ["practitioner"] },
  { devId: "user_dev_p3", email: "p3", name: "Pedro Díaz", roles: ["practitioner"] },
  { devId: "user_dev_p4", email: "p4", name: "Patricia Ruiz", roles: ["practitioner"] },
];

/**
 * `+clerk_test` addresses sign in on a Clerk development instance with the fixed code
 * 424242 when Clerk asks to verify a new device, and Clerk sends them no email.
 */
export const staffEmail = (local: string) => `${local}+clerk_test@example.com`;

export const devOrganizationId = "org_dev";
export const devPassword = "rubens-dev-password";
export const devCookie = "rubens_dev_user";
