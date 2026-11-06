import { asc, eq } from "drizzle-orm";

import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { member, practitioner } from "#/organization/schema.ts";

// The practitioners as the areas that hang off one read them: medical
// services now, schedules and time off as they port (#131). A practitioner
// row outlives the role, so "active" means a member who is active and still
// holds the role.

export interface SchedulePractitioner {
  id: string;
  displayName: string;
}

/**
 * A practitioner, whether they still practise, and whether `acting` may change
 * what is theirs: an admin anyone's, a practitioner their own.
 */
export function findPractitioner(writer: Writer, acting: Acting, practitionerId: string) {
  const found = writer
    .select({
      id: practitioner.id,
      displayName: practitioner.displayName,
      gridMinutes: practitioner.gridMinutes,
      userId: member.userId,
      roles: member.roles,
      memberActive: member.active,
    })
    .from(practitioner)
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(eq(practitioner.id, practitionerId))
    .get();
  if (!found) {
    return undefined;
  }
  const { userId, roles, memberActive, ...rest } = found;
  return {
    ...rest,
    active: memberActive && roles.includes("practitioner"),
    canEdit:
      acting.roles.includes("admin") ||
      (acting.roles.includes("practitioner") && userId === acting.userId),
  };
}

/** The practising practitioners, by name: whom the schedules and medical services screens list. */
export function listSchedulePractitioners(writer: Writer): {
  ok: true;
  practitioners: SchedulePractitioner[];
} {
  const rows = writer
    .select({ id: practitioner.id, displayName: practitioner.displayName, roles: member.roles })
    .from(practitioner)
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(eq(member.active, true))
    .orderBy(asc(practitioner.displayName))
    .all();
  return {
    ok: true,
    practitioners: rows
      .filter((row) => row.roles.includes("practitioner"))
      .map(({ id, displayName }) => ({ id, displayName })),
  };
}
