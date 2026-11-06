import { asc, eq, sql } from "drizzle-orm";

import { roleNames } from "#/lib/access.ts";
import type { Role } from "#/lib/access.ts";
import { createdFields } from "#/lib/audit-fields.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import { member, organization, practitioner } from "#/organization/schema.ts";

/**
 * Who calls into the organization's object: the user id the Worker took from a
 * verified session (`src/server/caller.ts`). The object reads that member's
 * roles and active flag from its own table on every call, so a role change or
 * a deactivation applies to the very next one; a session token's roles claim
 * is never trusted (#131).
 */
export interface Caller {
  userId: string;
}

/** A member the object found active and allowed: what an operation acts as. */
export interface Acting {
  userId: string;
  roles: readonly Role[];
}

/** What a call needs from its member: one of `roles`, or any role. */
export type Requirement = "any" | readonly Role[];

export type Refusal = "unauthenticated" | "forbidden";

export type Authorized = { ok: true; acting: Acting } | { ok: false; reason: Refusal };

/**
 * Authorizes `caller` against the member table: a user who is not a member, or
 * is deactivated, counts as signed out; a member without one of the required
 * roles is forbidden.
 */
export function authorize(
  database: Database,
  caller: Caller,
  requirement: Requirement,
): Authorized {
  const row = database
    .select({ roles: member.roles, active: member.active })
    .from(member)
    .where(eq(member.userId, caller.userId))
    .get();
  if (!row || !row.active) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (requirement !== "any" && !row.roles.some((role) => requirement.includes(role))) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, acting: { userId: caller.userId, roles: row.roles } };
}

export interface MemberInput {
  userId: string;
  name: string;
  email: string;
  roles: readonly Role[];
}

/** Who is signed in, and for which organization: what the app shell shows. */
export interface Viewer {
  userId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  email: string;
  roles: readonly Role[];
}

export function viewerOf(database: Database, acting: Acting): Viewer {
  const row = database
    .select({
      name: member.name,
      email: member.email,
      organizationId: organization.id,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, sql`true`)
    .where(eq(member.userId, acting.userId))
    .get();
  if (!row) {
    throw new Error(`viewer ${acting.userId} has no member or organization row`);
  }
  return { userId: acting.userId, roles: acting.roles, ...row };
}

type MemberRefusal = "invalidMember" | "memberExists";

/**
 * Adds a member, and a practitioner row when they hold that role, with its
 * audit entry, in `writer`'s transaction. A refusal writes nothing. Who may add
 * one is the caller's concern.
 */
export function insertMember(
  writer: Writer,
  actingUserId: string,
  input: MemberInput,
): { ok: true } | { ok: false; reason: MemberRefusal } {
  const roles = roleNames.filter((role) => input.roles.includes(role));
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (roles.length === 0 || !name || !email || !input.userId) {
    return { ok: false, reason: "invalidMember" };
  }
  const taken = writer
    .select({ userId: member.userId })
    .from(member)
    .where(sql`${member.userId} = ${input.userId} or lower(${member.email}) = ${email}`)
    .get();
  if (taken) {
    return { ok: false, reason: "memberExists" };
  }
  writer.insert(member).values({ userId: input.userId, name, email, roles }).run();
  recordAudit(writer, actingUserId, {
    action: "create",
    entityType: "member",
    entityId: input.userId,
    patientId: null,
    before: null,
    after: createdFields({ name, email, roles: roles.join(",") }),
  });
  if (roles.includes("practitioner")) {
    writer.insert(practitioner).values({ memberId: input.userId, displayName: name }).run();
  }
  return { ok: true };
}

/**
 * Creates the organization's row and its first admin, once. A second call
 * changes nothing and says so.
 */
export function setUpOrganization(
  database: Database,
  input: { organizationId: string; name: string; admin: Omit<MemberInput, "roles"> },
): { ok: true } | { ok: false; reason: "alreadySetUp" | "invalidOrganization" | MemberRefusal } {
  const name = input.name.trim();
  if (!name || !input.organizationId) {
    return { ok: false, reason: "invalidOrganization" };
  }
  return database.transaction((tx) => {
    if (tx.select({ id: organization.id }).from(organization).get()) {
      return { ok: false, reason: "alreadySetUp" } as const;
    }
    // The member first: when it is refused, nothing has been written.
    const added = insertMember(tx, input.admin.userId, { ...input.admin, roles: ["admin"] });
    if (added.ok) {
      tx.insert(organization).values({ id: input.organizationId, name }).run();
    }
    return added;
  });
}

export interface DevMember {
  userId: string;
  name: string;
  roles: readonly Role[];
}

/** The active members, by name: whom the dev sign-in offers. */
export function listActiveMembers(database: Database): DevMember[] {
  return database
    .select({ userId: member.userId, name: member.name, roles: member.roles })
    .from(member)
    .where(eq(member.active, true))
    .orderBy(asc(member.name))
    .all();
}
