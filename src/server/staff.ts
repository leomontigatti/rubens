import { and, asc, eq } from "drizzle-orm";

import { member, practitioner, session, user } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { parseRoles } from "#/lib/access.ts";
import type { Actor, Role } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import {
  memberActiveChangeSchema,
  practitionerUpdateSchema,
  rolesChangeSchema,
  staffInputSchema,
  startingPasswordSchema,
} from "#/lib/staff.ts";
import type {
  MemberActiveChange,
  PractitionerUpdate,
  RolesChange,
  StaffInput,
  StartingPasswordChange,
} from "#/lib/staff.ts";

import { assignStartingPassword, createAccount } from "#/server/accounts.ts";
import type { CreateAccountResult } from "#/server/accounts.ts";

// The staff of the actor's organization: their accounts, roles and practitioner
// settings. Only an admin reads or changes them. Nothing is deleted: a
// deactivated member keeps their rows and can be reactivated. `database` is for
// tests, which pass a transaction running as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

export interface PractitionerSettings {
  displayName: string;
  specialty: string | null;
  keepsClinicalRecords: boolean;
}

export interface StaffMember {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  active: boolean;
  /** Kept after the practitioner role is removed; `null` if never granted. */
  practitioner: PractitionerSettings | null;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "lastAdmin";
type AccountRefusal = Extract<CreateAccountResult, { ok: false }>["reason"];

type Result<T, R extends string = Refusal> = ({ ok: true } & T) | { ok: false; reason: R };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const lastAdmin = { ok: false, reason: "lastAdmin" } as const;

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

const staffColumns = {
  memberId: member.id,
  userId: member.userId,
  name: user.name,
  email: user.email,
  role: member.role,
  active: member.active,
  displayName: practitioner.displayName,
  specialty: practitioner.specialty,
  keepsClinicalRecords: practitioner.keepsClinicalRecords,
};

async function selectStaff(tx: Transaction, actor: Actor, memberId?: string) {
  const rows = await tx
    .select(staffColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(practitioner, eq(practitioner.memberId, member.id))
    .where(
      and(
        eq(member.organizationId, actor.organizationId),
        memberId === undefined ? undefined : eq(member.id, memberId),
      ),
    )
    .orderBy(asc(user.name), asc(user.email));
  return rows.map(
    ({ role, displayName, specialty, keepsClinicalRecords, ...row }): StaffMember => ({
      ...row,
      roles: parseRoles(role),
      practitioner:
        displayName === null
          ? null
          : { displayName, specialty, keepsClinicalRecords: keepsClinicalRecords ?? true },
    }),
  );
}

async function findStaffMember(tx: Transaction, actor: Actor, memberId: string) {
  const [found] = await selectStaff(tx, actor, memberId);
  return found;
}

/** Whether `target` is the only active admin, so it must stay one. */
async function isLastActiveAdmin(tx: Transaction, actor: Actor, target: StaffMember) {
  if (!target.active || !target.roles.includes("admin")) {
    return false;
  }
  // `for update` locks the organization's active members until the change
  // commits, so two admins demoting or deactivating each other at once are
  // serialised: the second sees the first's change and is refused.
  const active = await tx
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, actor.organizationId), eq(member.active, true)))
    .for("update");
  return active.filter((row) => parseRoles(row.role).includes("admin")).length <= 1;
}

/** Creates the member's practitioner row, unless one survives from before. */
async function ensurePractitioner(tx: Transaction, actor: Actor, target: StaffMember) {
  await tx
    .insert(practitioner)
    .values({
      organizationId: actor.organizationId,
      memberId: target.memberId,
      displayName: target.name,
    })
    .onConflictDoNothing({ target: practitioner.memberId });
}

export async function listStaff(
  actor: Actor,
  database?: AnyDatabase,
): Promise<Result<{ staff: StaffMember[] }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => ({ ok: true as const, staff: await selectStaff(tx, actor) }),
    database,
  );
}

export async function getStaffMember(
  actor: Actor,
  input: { memberId: string },
  database?: AnyDatabase,
): Promise<Result<{ member: StaffMember }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => {
      const found = await findStaffMember(tx, actor, input.memberId);
      return found ? { ok: true as const, member: found } : notFound;
    },
    database,
  );
}

/**
 * Creates the account, the membership and, for a practitioner, the
 * practitioner row, in one transaction. Better Auth runs on that transaction
 * too, so a refusal or a failure leaves no user behind.
 */
export async function createStaffMember(
  actor: Actor,
  input: StaffInput,
  database?: AnyDatabase,
): Promise<Result<{ member: StaffMember }, Refusal | AccountRefusal>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = staffInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { roles, ...account } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const created = await createAccount(createAuth(tx), account);
      if (!created.ok) {
        return created;
      }
      const memberId = crypto.randomUUID();
      await tx.insert(member).values({
        id: memberId,
        organizationId: actor.organizationId,
        userId: created.userId,
        role: roles.join(","),
        createdAt: new Date(),
      });
      const found = (await findStaffMember(tx, actor, memberId))!;
      if (roles.includes("practitioner")) {
        await ensurePractitioner(tx, actor, found);
        return { ok: true as const, member: (await findStaffMember(tx, actor, memberId))! };
      }
      return { ok: true as const, member: found };
    },
    database,
  );
}

/**
 * Replaces the member's roles. Granting `practitioner` creates their
 * practitioner row; removing it keeps the row.
 */
export async function changeRoles(
  actor: Actor,
  input: RolesChange,
  database?: AnyDatabase,
): Promise<Result<{ member: StaffMember }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = rolesChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { memberId, roles } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const target = await findStaffMember(tx, actor, memberId);
      if (!target) {
        return notFound;
      }
      if (!roles.includes("admin") && (await isLastActiveAdmin(tx, actor, target))) {
        return lastAdmin;
      }
      await tx
        .update(member)
        .set({ role: roles.join(",") })
        .where(and(eq(member.id, memberId), eq(member.organizationId, actor.organizationId)));
      if (roles.includes("practitioner")) {
        await ensurePractitioner(tx, actor, target);
      }
      return { ok: true as const, member: (await findStaffMember(tx, actor, memberId))! };
    },
    database,
  );
}

export async function updatePractitioner(
  actor: Actor,
  input: PractitionerUpdate,
  database?: AnyDatabase,
): Promise<Result<{ member: StaffMember }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = practitionerUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { memberId, ...settings } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const updated = await tx
        .update(practitioner)
        .set(settings)
        .where(eq(practitioner.memberId, memberId))
        .returning({ id: practitioner.id });
      if (updated.length === 0) {
        return notFound;
      }
      return { ok: true as const, member: (await findStaffMember(tx, actor, memberId))! };
    },
    database,
  );
}

/**
 * Deactivates or reactivates a member. Deactivating ends their sessions; sign-in
 * and the shared server-function step refuse them from then on.
 */
export async function setMemberActive(
  actor: Actor,
  input: MemberActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = memberActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { memberId, active } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const target = await findStaffMember(tx, actor, memberId);
      if (!target) {
        return notFound;
      }
      if (!active && (await isLastActiveAdmin(tx, actor, target))) {
        return lastAdmin;
      }
      await tx
        .update(member)
        .set({ active })
        .where(and(eq(member.id, memberId), eq(member.organizationId, actor.organizationId)));
      if (!active) {
        await tx.delete(session).where(eq(session.userId, target.userId));
      }
      return { ok: true as const };
    },
    database,
  );
}

/** Gives the member a new starting password, which they must replace again. */
export async function setStartingPassword(
  actor: Actor,
  input: StartingPasswordChange,
  database?: AnyDatabase,
): Promise<Result<object, Refusal | Exclude<AccountRefusal, "emailTaken">>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = startingPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const target = await findStaffMember(tx, actor, parsed.data.memberId);
      if (!target) {
        return notFound;
      }
      return assignStartingPassword(createAuth(tx), target.userId, parsed.data.password);
    },
    database,
  );
}
