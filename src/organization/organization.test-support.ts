import { env, runInDurableObject } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";

import type { Role } from "#/lib/access.ts";

import type { Accounts, CreateUserResult } from "#/organization/accounts.ts";
import { openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import type { Organization } from "#/organization/organization.ts";
import { auditLog } from "#/organization/schema.ts";
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

/**
 * Adds a member named `name` with `roles`, as the first admin, and returns
 * them as a caller, with their practitioner id when they hold the role.
 */
export async function addStaff(
  organization: OrganizationStub,
  name: string,
  roles: Role[] = ["practitioner"],
) {
  const userId = `user-${crypto.randomUUID()}`;
  const added = await organization.addMember(adminCaller, {
    userId,
    name,
    email: `${userId}@example.com`,
    roles,
  });
  if (!added.ok) {
    throw new Error(`addMember refused: ${added.reason}`);
  }
  const listed = await organization.listSchedulePractitioners(adminCaller);
  const practitionerId = listed.ok
    ? listed.practitioners.find((row) => row.displayName === name)?.id
    : undefined;
  return { caller: { userId }, practitionerId: practitionerId ?? "" };
}

/** Adds an office, as the first admin, in `timeZone` or the default one. */
export async function addOffice(organization: OrganizationStub, name: string, timeZone?: string) {
  const created = await organization.createOffice(adminCaller, {
    name,
    address: "Av. Colón 100",
    timeZone,
  });
  if (!created.ok) {
    throw new Error(`createOffice refused: ${created.reason}`);
  }
  return created.office;
}

/** Adds a room to `officeId`, as the first admin. */
export async function addRoom(
  organization: OrganizationStub,
  officeId: string,
  name: string,
  capacity = 1,
) {
  const created = await organization.createRoom(adminCaller, { officeId, name, capacity });
  if (!created.ok) {
    throw new Error(`createRoom refused: ${created.reason}`);
  }
  return created.room;
}

/** Runs `work` on the object's storage directly: for what no method reads or writes yet. */
export function inStorage<T>(organization: OrganizationStub, work: (database: Database) => T) {
  return runInDurableObject(organization, (_instance, state) => work(openDatabase(state.storage)));
}

/** The audit entries about `entityId`, oldest first, as the log keeps them. */
export function auditEntriesFor(organization: OrganizationStub, entityId: string) {
  return inStorage(organization, (database) =>
    database
      .select({
        action: auditLog.action,
        entityType: auditLog.entityType,
        userId: auditLog.userId,
        patientId: auditLog.patientId,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      // Insertion order: two entries can share a millisecond.
      .orderBy(sql`rowid`)
      .all(),
  );
}

type Call = { [K in keyof Accounts]: [K, ...Parameters<Accounts[K]>] }[keyof Accounts];

type UserRefusal = Extract<CreateUserResult, { ok: false }>["reason"];

/**
 * A stand-in for Clerk's accounts. It records every call, and accepts a
 * password only when it is the user's current one.
 */
class FakeAccounts implements Accounts {
  calls: Call[] = [];
  lastUserId: string | undefined;
  readonly #passwords = new Map<string, string>();
  #refusal: UserRefusal | undefined;

  reset() {
    this.calls = [];
    this.#refusal = undefined;
  }

  /** Refuses the next user created, as Clerk would. */
  refuseNext(reason: UserRefusal) {
    this.#refusal = reason;
  }

  /** Forgets every password, so any current password is wrong. */
  rejectPasswords() {
    this.#passwords.clear();
  }

  createUser(user: Parameters<Accounts["createUser"]>[0]): Promise<CreateUserResult> {
    this.calls.push(["createUser", user]);
    const refusal = this.#refusal;
    this.#refusal = undefined;
    if (refusal) {
      return Promise.resolve({ ok: false, reason: refusal });
    }
    const userId = `user-${crypto.randomUUID()}`;
    this.lastUserId = userId;
    this.#passwords.set(userId, user.password);
    return Promise.resolve({ ok: true, userId });
  }

  updateMetadata(...call: Parameters<Accounts["updateMetadata"]>) {
    this.calls.push(["updateMetadata", ...call]);
    return Promise.resolve();
  }

  setPassword(userId: string, password: string) {
    this.calls.push(["setPassword", userId, password]);
    this.#passwords.set(userId, password);
    return Promise.resolve({ ok: true as const });
  }

  verifyPassword(userId: string, password: string) {
    this.calls.push(["verifyPassword", userId, password]);
    return Promise.resolve(this.#passwords.get(userId) === password);
  }

  ban(userId: string) {
    this.calls.push(["ban", userId]);
    return Promise.resolve();
  }

  unban(userId: string) {
    this.calls.push(["unban", userId]);
    return Promise.resolve();
  }
}

/**
 * The accounts a test installs in place of Clerk's, with
 * `vi.mock(import("#/organization/accounts.ts"), …)` returning it from
 * `accountsFor`. The object and the test share one isolate, so the test reads
 * the calls the object made.
 */
export const fakeAccounts = new FakeAccounts();
