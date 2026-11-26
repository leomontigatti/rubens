import { eq } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { coverageIdSchema, coverageInputSchema, coverageUpdateSchema } from "#/lib/coverages.ts";
import type { CoverageId, CoverageInput, CoverageUpdate, InsurerKind } from "#/lib/coverages.ts";
import { present } from "#/lib/present.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPatient } from "#/organization/patients.ts";
import { coverage, insurer } from "#/organization/schema.ts";

// A patient's coverage: they have one or none (`Particular`). Reception,
// admins and practitioners add, edit and remove it; adding one to a patient who
// has one is refused. A coverage is offered only active insurers, and keeps the
// one it has when that is deactivated. Every change is written to the audit log about
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
}

type Refusal = "invalidInput" | "notFound" | "insurerInactive" | "hasCoverage";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const insurerInactive = { ok: false, reason: "insurerInactive" } as const;
const hasCoverage = { ok: false, reason: "hasCoverage" } as const;

const coverageColumns = {
  id: coverage.id,
  patientId: coverage.patientId,
  insurerId: coverage.insurerId,
  insurerName: insurer.name,
  insurerKind: insurer.kind,
  insurerActive: insurer.active,
  plan: coverage.plan,
  memberNumber: coverage.memberNumber,
};

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

/** The patient's coverage, as a list of one, or none when they are private. */
export function listCoverages(
  database: Database,
  input: { patientId: string },
): Result<{ coverages: Coverage[] }> {
  const parsed = coverageInputSchema.shape.patientId.safeParse(input.patientId);
  if (!parsed.success || !findPatient(database, parsed.data)) {
    return notFound;
  }
  const coverages = selectCoverages(database).where(eq(coverage.patientId, parsed.data)).all();
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
  const fields = parsed.data;
  return database.transaction((tx) => {
    if (!findPatient(tx, fields.patientId)) {
      return notFound;
    }
    const existing = tx
      .select({ id: coverage.id })
      .from(coverage)
      .where(eq(coverage.patientId, fields.patientId))
      .get();
    if (existing) {
      return hasCoverage;
    }
    const refusal = checkInsurer(tx, fields.insurerId);
    if (refusal) {
      return refusal;
    }
    const created = tx.insert(coverage).values(fields).returning({ id: coverage.id }).get();
    const found = present(findCoverage(tx, created.id), "A coverage just inserted is found");
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
    const updated = present(findCoverage(tx, coverageId), "A coverage just updated is found");
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

/** Removes the patient's coverage, leaving them private. */
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
    return { ok: true as const };
  });
}
