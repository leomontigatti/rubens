import { asc, count, eq, sql } from "drizzle-orm";

import { roleNames } from "#/lib/access.ts";
import type { Role } from "#/lib/access.ts";
import { createdFields } from "#/lib/audit-fields.ts";
import { practitionerColors } from "#/lib/practitioner-colors.ts";

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

/**
 * What a call needs from its member: one of `roles`, or any role. Both refuse a
 * member who must still replace the starting password; `signedIn`, any active
 * member, does not, for the calls the change-password screen makes.
 */
export type Requirement = "any" | "signedIn" | readonly Role[];

// A practitioner changes their own medical services; which ones are theirs is
// the area's to decide (`src/organization/medical-services.ts`).
export const medicalServiceEditors = ["admin", "practitioner"] as const;
// The same for schedules and time off; a receptionist only reads them.
export const workingTimeEditors = medicalServiceEditors;

// Every staff role registers and edits patients, their coverages and guardians.
export const patientEditors = ["admin", "receptionist", "practitioner"] as const;

// Every staff role books; for whom is the area's to decide
// (`src/organization/appointments.ts`).
export const bookers = patientEditors;

export type Refusal = "unauthenticated" | "forbidden" | "mustChangePassword";

export type Authorized = { ok: true; acting: Acting } | { ok: false; reason: Refusal };

/**
 * Authorizes `caller` against the member table: a user who is not a member, or
 * is deactivated, counts as signed out; a member who must replace the starting
 * password is held to it; a member without one of the required roles is
 * forbidden.
 */
export function authorize(
  database: Database,
  caller: Caller,
  requirement: Requirement,
): Authorized {
  const row = database
    .select({
      roles: member.roles,
      active: member.active,
      mustChangePassword: member.mustChangePassword,
    })
    .from(member)
    .where(eq(member.userId, caller.userId))
    .get();
  if (!row || !row.active) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (requirement === "signedIn") {
    return { ok: true, acting: { userId: caller.userId, roles: row.roles } };
  }
  if (row.mustChangePassword) {
    return { ok: false, reason: "mustChangePassword" };
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
  /** Whether they sign in with a starting password they must replace; false when left out. */
  mustChangePassword?: boolean;
}

/** The organization's name, as its setup wrote it: what its templates name it by (`{{consultorio}}`). */
export function organizationName(database: Writer) {
  return database.select({ name: organization.name }).from(organization).get()?.name ?? "";
}

/** Who is signed in, and for which organization: what the app shell shows. */
export interface Viewer {
  userId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  email: string;
  roles: readonly Role[];
  mustChangePassword: boolean;
}

export function viewerOf(database: Database, acting: Acting): Viewer {
  const row = database
    .select({
      name: member.name,
      email: member.email,
      mustChangePassword: member.mustChangePassword,
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
  const mustChangePassword = input.mustChangePassword ?? false;
  writer
    .insert(member)
    .values({ userId: input.userId, name, email, roles, mustChangePassword })
    .run();
  recordAudit(writer, actingUserId, {
    action: "create",
    entityType: "member",
    entityId: input.userId,
    patientId: null,
    before: null,
    after: createdFields({ name, email, roles: roles.join(",") }),
  });
  if (roles.includes("practitioner")) {
    ensurePractitioner(writer, input.userId, name);
  }
  return { ok: true };
}

/**
 * Creates the member's practitioner row, unless one survives from before, in
 * the palette's next colour: the organization's practitioners take them in turn.
 */
export function ensurePractitioner(writer: Writer, memberId: string, displayName: string): void {
  const total = writer.select({ total: count() }).from(practitioner).get()?.total ?? 0;
  writer
    .insert(practitioner)
    .values({
      memberId,
      displayName,
      color: practitionerColors[total % practitionerColors.length],
    })
    .onConflictDoNothing({ target: practitioner.memberId })
    .run();
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
