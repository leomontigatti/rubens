import { env, runInDurableObject } from "cloudflare:test";

import type { Role } from "#/lib/access.ts";

import { openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import type { Organization } from "#/organization/organization.ts";
import type { WorkerEnv } from "#/server/caller.ts";

// Fixtures for the organization object's tests (`*.workers.test.ts`): a fresh
// object per call, set up with its first admin, and members by role.

const bindings = env as unknown as WorkerEnv;

export type OrganizationStub = DurableObjectStub<Organization>;

/** A new organization's object, never used by another test. */
export function freshOrganization(): { organizationId: string; organization: OrganizationStub } {
  const organizationId = `test-${crypto.randomUUID()}`;
  return {
    organizationId,
    organization: bindings.ORGANIZATION.get(bindings.ORGANIZATION.idFromName(organizationId)),
  };
}

export const adminCaller = { userId: "user-admin" };

/** A fresh organization, set up with `adminCaller` as its first admin. */
export async function setUpOrganization() {
  const fresh = freshOrganization();
  const setUp = await fresh.organization.setUp({
    organizationId: fresh.organizationId,
    name: "Consultorios Prueba",
    admin: { userId: adminCaller.userId, name: "Ana Admin", email: "ana@example.com" },
  });
  if (!setUp.ok) {
    throw new Error(`setUp refused: ${setUp.reason}`);
  }
  return fresh;
}

/** Adds a member with `roles`, as the first admin, and returns them as a caller. */
export async function addMember(organization: OrganizationStub, roles: Role[]) {
  const userId = `user-${crypto.randomUUID()}`;
  const added = await organization.addMember(adminCaller, {
    userId,
    name: `Miembro ${roles.join(" ")}`,
    email: `${userId}@example.com`,
    roles,
  });
  if (!added.ok) {
    throw new Error(`addMember refused: ${added.reason}`);
  }
  return { userId };
}

/** Runs `work` on the object's storage directly: for what no method reads or writes yet. */
export function inStorage<T>(organization: OrganizationStub, work: (database: Database) => T) {
  return runInDurableObject(organization, (_instance, state) => work(openDatabase(state.storage)));
}
