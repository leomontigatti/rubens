import { and, asc, desc, eq, ne } from "drizzle-orm";

import { coverage, insurer, patient } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor, Role } from "#/lib/access.ts";
import { coverageIdSchema, coverageInputSchema, coverageUpdateSchema } from "#/lib/coverages.ts";
import type { CoverageId, CoverageInput, CoverageUpdate, InsurerKind } from "#/lib/coverages.ts";

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";
import { lockPatient } from "#/server/patients.ts";

// A patient's coverages. Reception, admins and practitioners add, edit and
// remove them. A patient with coverages has exactly one primary: the first
// one added, until another is made primary or the primary is removed, when the
// flag moves. A coverage is offered only active insurers, and keeps the one it
// has when that is deactivated. Every change is written to the audit log about
// the patient, in its own transaction. `database` is for tests, which pass a
// transaction running as the app role.

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

type Refusal = "forbidden" | "invalidInput" | "notFound" | "insurerInactive";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const insurerInactive = { ok: false, reason: "insurerInactive" } as const;

const editorRoles: readonly Role[] = ["admin", "receptionist", "practitioner"];

function canEdit(actor: Actor): boolean {
  return actor.roles.some((role) => editorRoles.includes(role));
}

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

/**
 * The fields an audit entry records: the insurer by its id, and by the name it
 * had then, since two insurers may share a name.
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

/**
 * The changed fields of a coverage update. A new insurer records its name on
 * both sides even when the name is the same, so the history shows the switch.
 */
function changedCoverageFields(before: Coverage, after: Coverage) {
  const changed = changedFields(auditedValues(before), auditedValues(after));
  if (changed && before.insurerId !== after.insurerId) {
    changed.before.insurer = before.insurerName;
    changed.after.insurer = after.insurerName;
  }
  return changed;
}

function selectCoverages(tx: Transaction) {
  return tx
    .select(coverageColumns)
    .from(coverage)
    .innerJoin(insurer, eq(insurer.id, coverage.insurerId));
}

async function findCoverage(tx: Transaction, coverageId: string) {
  const [found] = await selectCoverages(tx).where(eq(coverage.id, coverageId));
  return found;
}

async function patientExists(tx: Transaction, patientId: string): Promise<boolean> {
  const [found] = await tx
    .select({ id: patient.id })
    .from(patient)
    .where(eq(patient.id, patientId));
  return found !== undefined;
}

/**
 * Finds a coverage and locks its patient, then reads the coverage again: a
 * change to it starts from the committed row, after any other change to the
 * patient's coverages.
 */
async function lockCoverage(tx: Transaction, coverageId: string) {
  const found = await findCoverage(tx, coverageId);
  if (!found || !(await lockPatient(tx, found.patientId))) {
    return undefined;
  }
  return findCoverage(tx, coverageId);
}

/** Whether a coverage may be given `insurerId`: `null` when it may, the refusal otherwise. */
async function checkInsurer(tx: Transaction, insurerId: string) {
  const [found] = await tx
    .select({ active: insurer.active })
    .from(insurer)
    .where(eq(insurer.id, insurerId));
  if (!found) {
    return notFound;
  }
  return found.active ? null : insurerInactive;
}

/** Sets a coverage's primary flag and writes the change to the audit log. */
async function setPrimary(tx: Transaction, actor: Actor, row: Coverage, primary: boolean) {
  await tx.update(coverage).set({ primary }).where(eq(coverage.id, row.id));
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "coverage",
    entityId: row.id,
    patientId: row.patientId,
    before: { primary: row.primary },
    after: { primary },
  });
}

/** Takes the flag from the patient's primary coverage other than `exceptId`, if any. */
async function clearPrimary(tx: Transaction, actor: Actor, patientId: string, exceptId?: string) {
  const [current] = await selectCoverages(tx).where(
    and(
      eq(coverage.patientId, patientId),
      eq(coverage.primary, true),
      exceptId ? ne(coverage.id, exceptId) : undefined,
    ),
  );
  if (current) {
    await setPrimary(tx, actor, current, false);
  }
  return current;
}

/** The patient's coverages, the primary first, then in the order they were added. */
export async function listCoverages(
  actor: Actor,
  input: { patientId: string },
  database?: AnyDatabase,
): Promise<Result<{ coverages: Coverage[] }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = coverageInputSchema.shape.patientId.safeParse(input.patientId);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      if (!(await patientExists(tx, parsed.data))) {
        return notFound;
      }
      const rows = await selectCoverages(tx)
        .where(eq(coverage.patientId, parsed.data))
        .orderBy(desc(coverage.primary), asc(coverage.createdAt), asc(coverage.id));
      return { ok: true as const, coverages: rows };
    },
    database,
  );
}

export async function addCoverage(
  actor: Actor,
  input: CoverageInput,
  database?: AnyDatabase,
): Promise<Result<{ coverage: Coverage }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = coverageInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { primary: asPrimary, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      if (!(await lockPatient(tx, fields.patientId))) {
        return notFound;
      }
      const refusal = await checkInsurer(tx, fields.insurerId);
      if (refusal) {
        return refusal;
      }
      const [primary] = await tx
        .select({ id: coverage.id })
        .from(coverage)
        .where(and(eq(coverage.patientId, fields.patientId), eq(coverage.primary, true)));
      if (asPrimary) {
        await clearPrimary(tx, actor, fields.patientId);
      }
      const [created] = await tx
        .insert(coverage)
        .values({
          ...fields,
          organizationId: actor.organizationId,
          primary: asPrimary || primary === undefined,
        })
        .returning({ id: coverage.id });
      const found = (await findCoverage(tx, created!.id))!;
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "coverage",
        entityId: found.id,
        patientId: found.patientId,
        before: null,
        after: createdFields(auditedValues(found)),
      });
      return { ok: true as const, coverage: found };
    },
    database,
  );
}

/** Replaces a coverage's insurer, plan and member number with `input`'s. */
export async function updateCoverage(
  actor: Actor,
  input: CoverageUpdate,
  database?: AnyDatabase,
): Promise<Result<{ coverage: Coverage }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = coverageUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { coverageId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const current = await lockCoverage(tx, coverageId);
      if (!current) {
        return notFound;
      }
      if (fields.insurerId !== current.insurerId) {
        const refusal = await checkInsurer(tx, fields.insurerId);
        if (refusal) {
          return refusal;
        }
      }
      await tx.update(coverage).set(fields).where(eq(coverage.id, coverageId));
      const updated = (await findCoverage(tx, coverageId))!;
      const changed = changedCoverageFields(current, updated);
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "coverage",
          entityId: coverageId,
          patientId: updated.patientId,
          ...changed,
        });
      }
      return { ok: true as const, coverage: updated };
    },
    database,
  );
}

/** Makes a coverage the patient's primary one, taking the flag from the last. */
export async function makeCoveragePrimary(
  actor: Actor,
  input: CoverageId,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = coverageIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const current = await lockCoverage(tx, parsed.data.coverageId);
      if (!current) {
        return notFound;
      }
      if (!current.primary) {
        await clearPrimary(tx, actor, current.patientId, current.id);
        await setPrimary(tx, actor, current, true);
      }
      return { ok: true as const };
    },
    database,
  );
}

/**
 * Removes a coverage. When it was the primary one, the oldest coverage left
 * becomes primary.
 */
export async function removeCoverage(
  actor: Actor,
  input: CoverageId,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = coverageIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const current = await lockCoverage(tx, parsed.data.coverageId);
      if (!current) {
        return notFound;
      }
      await tx.delete(coverage).where(eq(coverage.id, current.id));
      await recordAudit(tx, actor, {
        action: "delete",
        entityType: "coverage",
        entityId: current.id,
        patientId: current.patientId,
        before: createdFields(auditedValues(current)),
        after: null,
      });
      if (current.primary) {
        const [next] = await selectCoverages(tx)
          .where(eq(coverage.patientId, current.patientId))
          .orderBy(asc(coverage.createdAt), asc(coverage.id))
          .limit(1);
        if (next) {
          await setPrimary(tx, actor, next, true);
        }
      }
      return { ok: true as const };
    },
    database,
  );
}
