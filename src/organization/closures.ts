import { asc, desc, eq } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  closureDeleteSchema,
  closureInputSchema,
  closureUpdateSchema,
  toRangeEntry,
  toTimeRange,
} from "#/lib/time-ranges.ts";
import type {
  AffectsAppointments,
  ClosureDelete,
  ClosureInput,
  ClosureUpdate,
  RangeEntry,
} from "#/lib/time-ranges.ts";

import { recordAudit } from "#/organization/audit.ts";
import { askingFirst, settlingToReschedule, storedAnswer } from "#/organization/change-messages.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { closure, office } from "#/organization/schema.ts";

// Closures of one office or the whole organization. Everyone reads them; only
// admins change them (the object's requirement). An office's closure is read
// in that office's zone, the organization's in its default zone. Closures may
// overlap, and they change no record of past work, so they can always be
// edited or deleted. Every change is written to the audit log, about no patient.

export interface Closure {
  id: string;
  /** Null when the whole organization is closed. */
  officeId: string | null;
  officeName: string | null;
  entry: RangeEntry;
}

/** An active office a closure can be recorded for. */
export interface OfficeOption {
  id: string;
  name: string;
}

type Refusal = "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** Every closure, latest first, the offices a new one can close, and whether `acting` may. */
export function listClosures(
  database: Database,
  acting: Acting,
): { ok: true; closures: Closure[]; offices: OfficeOption[]; canEdit: boolean } {
  const rows = database
    .select({
      id: closure.id,
      officeId: closure.officeId,
      officeName: office.name,
      timeZone: office.timeZone,
      startsAt: closure.startsAt,
      endsAt: closure.endsAt,
    })
    .from(closure)
    .leftJoin(office, eq(office.id, closure.officeId))
    .orderBy(desc(closure.startsAt))
    .all();
  const offices = database
    .select({ id: office.id, name: office.name })
    .from(office)
    .where(eq(office.active, true))
    .orderBy(asc(office.name))
    .all();
  return {
    ok: true,
    closures: rows.map((row) => ({
      id: row.id,
      officeId: row.officeId,
      officeName: row.officeName,
      entry: toRangeEntry(
        { start: new Date(row.startsAt), end: new Date(row.endsAt) },
        row.timeZone ?? defaultTimeZone,
      ),
    })),
    offices,
    canEdit: acting.roles.includes("admin"),
  };
}

/**
 * A closure of `officeId` over `entry`, as stored: read in the office's zone,
 * or `undefined` when the office is missing.
 */
function closureOf(writer: Writer, officeId: string | null, entry: RangeEntry) {
  let timeZone = defaultTimeZone;
  if (officeId !== null) {
    const found = writer
      .select({ timeZone: office.timeZone })
      .from(office)
      .where(eq(office.id, officeId))
      .get();
    if (!found) {
      return undefined;
    }
    timeZone = found.timeZone;
  }
  const { start, end } = toTimeRange(entry, timeZone);
  return { officeId, startsAt: +start, endsAt: +end };
}

export function createClosure(
  database: Database,
  acting: Acting,
  input: ClosureInput,
): Result<{ closure: { id: string } }> | AffectsAppointments {
  const parsed = closureInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { officeId, entry, ...notice } = parsed.data;
  return askingFirst(() =>
    database.transaction((tx) => {
      const span = closureOf(tx, officeId, entry);
      if (!span) {
        return notFound;
      }
      const values = { ...span, ...storedAnswer(notice) };
      const created = settlingToReschedule(tx, null, notice, () =>
        tx.insert(closure).values(values).returning({ id: closure.id }).get(),
      );
      recordAudit(tx, acting.userId, {
        action: "create",
        entityType: "closure",
        entityId: created.id,
        patientId: null,
        before: null,
        after: createdFields(values),
      });
      return { ok: true as const, closure: created };
    }),
  );
}

function findClosure(writer: Writer, closureId: string) {
  return writer
    .select({
      officeId: closure.officeId,
      startsAt: closure.startsAt,
      endsAt: closure.endsAt,
      tellPatients: closure.tellPatients,
    })
    .from(closure)
    .where(eq(closure.id, closureId))
    .get();
}

export function updateClosure(
  database: Database,
  acting: Acting,
  input: ClosureUpdate,
): Result<object> | AffectsAppointments {
  const parsed = closureUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { closureId, officeId, entry, ...notice } = parsed.data;
  return askingFirst(() =>
    database.transaction((tx) => {
      const current = findClosure(tx, closureId);
      const span = closureOf(tx, officeId, entry);
      if (!current || !span) {
        return notFound;
      }
      const values = { ...span, ...storedAnswer(notice) };
      settlingToReschedule(tx, null, notice, () =>
        tx.update(closure).set(values).where(eq(closure.id, closureId)).run(),
      );
      const changed = changedFields(current, values);
      if (changed) {
        recordAudit(tx, acting.userId, {
          action: "update",
          entityType: "closure",
          entityId: closureId,
          patientId: null,
          ...changed,
        });
      }
      return { ok: true as const };
    }),
  );
}

export function deleteClosure(
  database: Database,
  acting: Acting,
  input: ClosureDelete,
): Result<object> {
  const parsed = closureDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { closureId } = parsed.data;
  return database.transaction((tx) => {
    const current = findClosure(tx, closureId);
    if (!current) {
      return notFound;
    }
    settlingToReschedule(tx, null, false, () =>
      tx.delete(closure).where(eq(closure.id, closureId)).run(),
    );
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "closure",
      entityId: closureId,
      patientId: null,
      before: current,
      after: null,
    });
    return { ok: true as const };
  });
}
