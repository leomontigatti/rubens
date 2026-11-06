import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { coverageIdSchema, coverageInputSchema, coverageUpdateSchema } from "#/lib/coverages.ts";
import type { CoverageId, CoverageInput, CoverageUpdate, InsurerKind } from "#/lib/coverages.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPatient } from "#/organization/patients.ts";
import { coverage, insurer } from "#/organization/schema.ts";

// A patient's coverages. Reception, admins and practitioners add, edit and
// remove them. A patient with coverages has exactly one primary: the first
// one added, until another is made primary or the primary is removed, when the
// flag moves. A coverage is offered only active insurers, and keeps the one it
// has when that is deactivated. Every change is written to the audit log about
// the patient, in its own transaction.

export interface Coverage {
  id: string;
  patientId: string;
  insurerId: string;
  insurerName: string;
  insurerKind: InsurerKind;
  /** Whether the insurer is still offered; a coverage keeps a deactivated one. */
  insurerActive: boolean;
  plan: string | null;
  memberNumber: string;
  primary: boolean;
}

type Refusal = "invalidInput" | "notFound" | "insurerInactive";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const insurerInactive = { ok: false, reason: "insurerInactive" } as const;

const coverageColumns = {
  id: coverage.id,
  patientId: coverage.patientId,
  insurerId: coverage.insurerId,
  insurerName: insurer.name,
  insurerKind: insurer.kind,
  insurerActive: insurer.active,
  plan: coverage.plan,
  memberNumber: coverage.memberNumber,
  primary: coverage.primary,
};

// The order coverages were added in; two can share a millisecond.
const added = [asc(coverage.createdAt), asc(sql`${coverage}.rowid`)];

/**
 * The fields an audit entry records: the insurer by its id, and by the name it
 * had then, since an insurer can be renamed.
 */
function auditedValues(row: Coverage) {
  return {
    insurerId: row.insurerId,
    insurer: row.insurerName,
    plan: row.plan,
    memberNumber: row.memberNumber,
    primary: row.primary,
  };
}

function selectCoverages(writer: Writer) {
  return writer
    .select(coverageColumns)
    .from(coverage)
    .innerJoin(insurer, eq(insurer.id, coverage.insurerId));
}

function findCoverage(writer: Writer, coverageId: string) {
  return selectCoverages(writer).where(eq(coverage.id, coverageId)).get();
}

/** Whether a coverage may be given `insurerId`: `null` when it may, the refusal otherwise. */
function checkInsurer(writer: Writer, insurerId: string) {
  const found = writer
    .select({ active: insurer.active })
    .from(insurer)
    .where(eq(insurer.id, insurerId))
    .get();
  if (!found) {
    return notFound;
  }
  return found.active ? null : insurerInactive;
}

/** Sets a coverage's primary flag and writes the change to the audit log. */
function setPrimary(writer: Writer, acting: Acting, row: Coverage, primary: boolean) {
  writer.update(coverage).set({ primary }).where(eq(coverage.id, row.id)).run();
  recordAudit(writer, acting.userId, {
    action: "update",
    entityType: "coverage",
    entityId: row.id,
    patientId: row.patientId,
    before: { primary: row.primary },
    after: { primary },
  });
}

/** Takes the flag from the patient's primary coverage other than `exceptId`, if any. */
function clearPrimary(writer: Writer, acting: Acting, patientId: string, exceptId?: string) {
  const current = selectCoverages(writer)
    .where(
      and(
        eq(coverage.patientId, patientId),
        eq(coverage.primary, true),
        exceptId ? ne(coverage.id, exceptId) : undefined,
      ),
    )
    .get();
  if (current) {
    setPrimary(writer, acting, current, false);
  }
}

/** The patient's coverages, the primary first, then in the order they were added. */
export function listCoverages(
  database: Database,
  input: { patientId: string },
): Result<{ coverages: Coverage[] }> {
  const parsed = coverageInputSchema.shape.patientId.safeParse(input.patientId);
  if (!parsed.success || !findPatient(database, parsed.data)) {
    return notFound;
  }
  const coverages = selectCoverages(database)
    .where(eq(coverage.patientId, parsed.data))
    .orderBy(desc(coverage.primary), ...added)
    .all();
  return { ok: true, coverages };
}

export function addCoverage(
  database: Database,
  acting: Acting,
  input: CoverageInput,
): Result<{ coverage: Coverage }> {
  const parsed = coverageInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { primary: asPrimary, ...fields } = parsed.data;
  return database.transaction((tx) => {
    if (!findPatient(tx, fields.patientId)) {
      return notFound;
    }
    const refusal = checkInsurer(tx, fields.insurerId);
    if (refusal) {
      return refusal;
    }
    const primary = tx
      .select({ id: coverage.id })
      .from(coverage)
      .where(and(eq(coverage.patientId, fields.patientId), eq(coverage.primary, true)))
      .get();
    if (asPrimary) {
      clearPrimary(tx, acting, fields.patientId);
    }
    const created = tx
      .insert(coverage)
      .values({ ...fields, primary: asPrimary || primary === undefined })
      .returning({ id: coverage.id })
      .get();
    const found = findCoverage(tx, created.id)!;
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "coverage",
      entityId: found.id,
      patientId: found.patientId,
      before: null,
      after: createdFields(auditedValues(found)),
    });
    return { ok: true as const, coverage: found };
  });
}

/** Replaces a coverage's insurer, plan and member number with `input`'s. */
export function updateCoverage(
  database: Database,
  acting: Acting,
  input: CoverageUpdate,
): Result<{ coverage: Coverage }> {
  const parsed = coverageUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { coverageId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = findCoverage(tx, coverageId);
    if (!current) {
      return notFound;
    }
    if (fields.insurerId !== current.insurerId) {
      const refusal = checkInsurer(tx, fields.insurerId);
      if (refusal) {
        return refusal;
      }
    }
    tx.update(coverage).set(fields).where(eq(coverage.id, coverageId)).run();
    const updated = findCoverage(tx, coverageId)!;
    const changed = changedFields(auditedValues(current), auditedValues(updated));
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "coverage",
        entityId: coverageId,
        patientId: updated.patientId,
        ...changed,
      });
    }
    return { ok: true as const, coverage: updated };
  });
}

/** Makes a coverage the patient's primary one, taking the flag from the last. */
export function makeCoveragePrimary(
  database: Database,
  acting: Acting,
  input: CoverageId,
): Result<object> {
  const parsed = coverageIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return database.transaction((tx) => {
    const current = findCoverage(tx, parsed.data.coverageId);
    if (!current) {
      return notFound;
    }
    if (!current.primary) {
      clearPrimary(tx, acting, current.patientId, current.id);
      setPrimary(tx, acting, current, true);
    }
    return { ok: true as const };
  });
}

/**
 * Removes a coverage. When it was the primary one, the oldest coverage left
 * becomes primary.
 */
export function removeCoverage(
  database: Database,
  acting: Acting,
  input: CoverageId,
): Result<object> {
  const parsed = coverageIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return database.transaction((tx) => {
    const current = findCoverage(tx, parsed.data.coverageId);
    if (!current) {
      return notFound;
    }
    tx.delete(coverage).where(eq(coverage.id, current.id)).run();
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "coverage",
      entityId: current.id,
      patientId: current.patientId,
      before: createdFields(auditedValues(current)),
      after: null,
    });
    if (current.primary) {
      const next = selectCoverages(tx)
        .where(eq(coverage.patientId, current.patientId))
        .orderBy(...added)
        .limit(1)
        .get();
      if (next) {
        setPrimary(tx, acting, next, true);
      }
    }
    return { ok: true as const };
  });
}
