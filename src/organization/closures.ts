import { desc, eq } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { practiceTimeZone } from "#/lib/dates.ts";
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
import { closure } from "#/organization/schema.ts";

// Closures of the whole organization: every room in it is closed. Everyone
// reads them; only admins change them (the object's requirement). They are read
// in the practice's zone. Closures may overlap, and they change no record of past work, so they can always be
// edited or deleted. Every change is written to the audit log, about no patient.

export interface Closure {
  id: string;
  entry: RangeEntry;
}

type Refusal = "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** Every closure, latest first, and whether `acting` may change them. */
export function listClosures(
  database: Database,
  acting: Acting,
): { ok: true; closures: Closure[]; canEdit: boolean } {
  const rows = database
    .select({ id: closure.id, startsAt: closure.startsAt, endsAt: closure.endsAt })
    .from(closure)
    .orderBy(desc(closure.startsAt))
    .all();
  return {
    ok: true,
    closures: rows.map((row) => ({
      id: row.id,
      entry: toRangeEntry(
        { start: new Date(row.startsAt), end: new Date(row.endsAt) },
        practiceTimeZone,
      ),
    })),
    canEdit: acting.roles.includes("admin"),
  };
}

/** A closure over `entry`, as stored. */
function closureOf(entry: RangeEntry) {
  const { start, end } = toTimeRange(entry, practiceTimeZone);
  return { startsAt: +start, endsAt: +end };
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
  const { entry, ...notice } = parsed.data;
  return askingFirst(() =>
    database.transaction((tx) => {
      const values = { ...closureOf(entry), ...storedAnswer(notice) };
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
  const { closureId, entry, ...notice } = parsed.data;
  return askingFirst(() =>
    database.transaction((tx) => {
      const current = findClosure(tx, closureId);
      if (!current) {
        return notFound;
      }
      const values = { ...closureOf(entry), ...storedAnswer(notice) };
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
