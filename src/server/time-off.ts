import { and, asc, eq, sql } from "drizzle-orm";

import { member, practitioner, timeOff } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  timeOffDeleteSchema,
  timeOffInputSchema,
  timeOffUpdateSchema,
  toRangeEntry,
  toTimeRange,
} from "#/lib/time-ranges.ts";
import type { RangeEntry, TimeOffDelete, TimeOffInput, TimeOffUpdate } from "#/lib/time-ranges.ts";

import { findPractitioner } from "#/server/schedules.ts";
import type { SchedulePractitioner } from "#/server/schedules.ts";

// Practitioners' time off. Everyone reads it; an admin records anyone's and a
// practitioner their own. Time off may overlap other time off, and it changes
// no record of past work, so it can always be edited or deleted. It is read in
// the organization's default zone. `database` is for tests, which pass a
// transaction running as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

export interface TimeOff {
  id: string;
  practitionerId: string;
  practitionerName: string;
  entry: RangeEntry;
  canEdit: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** Whether the actor may record time off at all, before any row is read. */
function mayEditSome(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("practitioner");
}

function mayEdit(actor: Actor, userId: string): boolean {
  return (
    actor.roles.includes("admin") ||
    (actor.roles.includes("practitioner") && userId === actor.userId)
  );
}

/**
 * Everyone's time off, latest first, and the active practitioners the actor
 * may record it for.
 */
export async function listTimeOff(
  actor: Actor,
  database?: AnyDatabase,
): Promise<{ timeOff: TimeOff[]; practitioners: SchedulePractitioner[] }> {
  return withTenant(
    actor,
    async (tx) => {
      const people = await tx
        .select({
          id: practitioner.id,
          displayName: practitioner.displayName,
          userId: member.userId,
          role: member.role,
          active: member.active,
        })
        .from(practitioner)
        .innerJoin(
          member,
          and(
            eq(member.id, practitioner.memberId),
            eq(member.organizationId, actor.organizationId),
          ),
        )
        .orderBy(asc(practitioner.displayName));
      const byId = new Map(people.map((person) => [person.id, person]));
      const rows = await tx
        .select({ id: timeOff.id, practitionerId: timeOff.practitionerId, during: timeOff.during })
        .from(timeOff)
        .orderBy(sql`lower(${timeOff.during}) desc`);
      return {
        timeOff: rows.map((row) => {
          const owner = byId.get(row.practitionerId)!;
          return {
            id: row.id,
            practitionerId: row.practitionerId,
            practitionerName: owner.displayName,
            entry: toRangeEntry(row.during, defaultTimeZone),
            canEdit: mayEdit(actor, owner.userId),
          };
        }),
        practitioners: people
          .filter((person) => person.active && parseRoles(person.role).includes("practitioner"))
          .filter((person) => mayEdit(actor, person.userId))
          .map(({ id, displayName }) => ({ id, displayName })),
      };
    },
    database,
  );
}

export async function createTimeOff(
  actor: Actor,
  input: TimeOffInput,
  database?: AnyDatabase,
): Promise<Result<{ timeOff: { id: string } }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = timeOffInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { practitionerId, entry } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const owner = await findPractitioner(tx, actor, practitionerId, false);
      if (!owner) {
        return notFound;
      }
      if (!owner.canEdit) {
        return forbidden;
      }
      const [created] = await tx
        .insert(timeOff)
        .values({
          organizationId: actor.organizationId,
          practitionerId: owner.id,
          during: toTimeRange(entry, defaultTimeZone),
        })
        .returning({ id: timeOff.id });
      return { ok: true as const, timeOff: created! };
    },
    database,
  );
}

/** The time off, when the actor may change it. */
async function findEditable(tx: Transaction, actor: Actor, timeOffId: string) {
  const [found] = await tx
    .select({ id: timeOff.id, practitionerId: timeOff.practitionerId })
    .from(timeOff)
    .where(eq(timeOff.id, timeOffId));
  if (!found) {
    return notFound;
  }
  const owner = await findPractitioner(tx, actor, found.practitionerId, false);
  if (!owner) {
    return notFound;
  }
  if (!owner.canEdit) {
    return forbidden;
  }
  return { ok: true as const, id: found.id };
}

export async function updateTimeOff(
  actor: Actor,
  input: TimeOffUpdate,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = timeOffUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { timeOffId, entry } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const editable = await findEditable(tx, actor, timeOffId);
      if (!editable.ok) {
        return editable;
      }
      await tx
        .update(timeOff)
        .set({ during: toTimeRange(entry, defaultTimeZone) })
        .where(eq(timeOff.id, editable.id));
      return { ok: true as const };
    },
    database,
  );
}

export async function deleteTimeOff(
  actor: Actor,
  input: TimeOffDelete,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = timeOffDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const editable = await findEditable(tx, actor, parsed.data.timeOffId);
      if (!editable.ok) {
        return editable;
      }
      await tx.delete(timeOff).where(eq(timeOff.id, editable.id));
      return { ok: true as const };
    },
    database,
  );
}
