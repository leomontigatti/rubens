import { asc, desc, eq } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  timeOffDeleteSchema,
  timeOffInputSchema,
  timeOffUpdateSchema,
  toRangeEntry,
  toTimeRange,
} from "#/lib/time-ranges.ts";
import type { RangeEntry, TimeOffDelete, TimeOffInput, TimeOffUpdate } from "#/lib/time-ranges.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import type { SchedulePractitioner } from "#/organization/practitioners.ts";
import { member, practitioner, timeOff } from "#/organization/schema.ts";

// Practitioners' time off. Everyone reads it; an admin records anyone's and a
// practitioner their own (the object requires one of the two roles, and
// `findPractitioner` decides whose). Time off may overlap other time off, and
// it changes no record of past work, so it can always be edited or deleted.
// It is read in the organization's default zone. Every change is written to
// the audit log, about no patient.

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

function mayEdit(acting: Acting, userId: string): boolean {
  return (
    acting.roles.includes("admin") ||
    (acting.roles.includes("practitioner") && userId === acting.userId)
  );
}

/** An entry as the stored span, in the organization's default zone. */
function spanOf(entry: RangeEntry) {
  const { start, end } = toTimeRange(entry, defaultTimeZone);
  return { startsAt: +start, endsAt: +end };
}

/**
 * Everyone's time off, latest first, and the active practitioners `acting`
 * may record it for.
 */
export function listTimeOff(
  database: Database,
  acting: Acting,
): { ok: true; timeOff: TimeOff[]; practitioners: SchedulePractitioner[] } {
  const people = database
    .select({
      id: practitioner.id,
      displayName: practitioner.displayName,
      userId: member.userId,
      roles: member.roles,
      active: member.active,
    })
    .from(practitioner)
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .orderBy(asc(practitioner.displayName))
    .all();
  const byId = new Map(people.map((person) => [person.id, person]));
  const rows = database.select().from(timeOff).orderBy(desc(timeOff.startsAt)).all();
  return {
    ok: true,
    timeOff: rows.map((row) => {
      const owner = byId.get(row.practitionerId)!;
      return {
        id: row.id,
        practitionerId: row.practitionerId,
        practitionerName: owner.displayName,
        entry: toRangeEntry(
          { start: new Date(row.startsAt), end: new Date(row.endsAt) },
          defaultTimeZone,
        ),
        canEdit: mayEdit(acting, owner.userId),
      };
    }),
    practitioners: people
      .filter((person) => person.active && person.roles.includes("practitioner"))
      .filter((person) => mayEdit(acting, person.userId))
      .map(({ id, displayName }) => ({ id, displayName })),
  };
}

export function createTimeOff(
  database: Database,
  acting: Acting,
  input: TimeOffInput,
): Result<{ timeOff: { id: string } }> {
  const parsed = timeOffInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { practitionerId, entry } = parsed.data;
  return database.transaction((tx) => {
    const owner = findPractitioner(tx, acting, practitionerId);
    if (!owner) {
      return notFound;
    }
    if (!owner.canEdit) {
      return forbidden;
    }
    const values = { practitionerId: owner.id, ...spanOf(entry) };
    const created = tx.insert(timeOff).values(values).returning({ id: timeOff.id }).get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "timeOff",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(values),
    });
    return { ok: true as const, timeOff: created };
  });
}

/** The time off, when `acting` may change it. */
function findEditable(writer: Writer, acting: Acting, timeOffId: string) {
  const found = writer.select().from(timeOff).where(eq(timeOff.id, timeOffId)).get();
  if (!found) {
    return notFound;
  }
  const owner = findPractitioner(writer, acting, found.practitionerId);
  if (!owner) {
    return notFound;
  }
  if (!owner.canEdit) {
    return forbidden;
  }
  return { ok: true as const, found };
}

export function updateTimeOff(
  database: Database,
  acting: Acting,
  input: TimeOffUpdate,
): Result<object> {
  const parsed = timeOffUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { timeOffId, entry } = parsed.data;
  return database.transaction((tx) => {
    const editable = findEditable(tx, acting, timeOffId);
    if (!editable.ok) {
      return editable;
    }
    const span = spanOf(entry);
    tx.update(timeOff).set(span).where(eq(timeOff.id, timeOffId)).run();
    const changed = changedFields(editable.found, span);
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "timeOff",
        entityId: timeOffId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const };
  });
}

export function deleteTimeOff(
  database: Database,
  acting: Acting,
  input: TimeOffDelete,
): Result<object> {
  const parsed = timeOffDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    const editable = findEditable(tx, acting, parsed.data.timeOffId);
    if (!editable.ok) {
      return editable;
    }
    const { id, practitionerId, startsAt, endsAt } = editable.found;
    tx.delete(timeOff).where(eq(timeOff.id, id)).run();
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "timeOff",
      entityId: id,
      patientId: null,
      before: { practitionerId, startsAt, endsAt },
      after: null,
    });
    return { ok: true as const };
  });
}
