import { auditLog } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";

// The one way to write the append-only audit log (ADR-0003). Every service
// that changes a patient's data, and later clinical records, calls it inside
// the change's own transaction, so the entry and the change commit together.
// An entry holds patient data: it is never logged.

export type AuditAction = "create" | "update" | "deactivate" | "reactivate";

/** A field's value as the log keeps it: instants as ISO strings. */
export type AuditValue = string | number | boolean | null;

export type AuditValues = Record<string, AuditValue>;

/** An entity's fields, as the service reads them. */
type Fields = Record<string, AuditValue | Date | undefined>;

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** The patient the entry is about, when there is one. */
  patientId: string | null;
  before: AuditValues | null;
  after: AuditValues | null;
}

function comparable(value: AuditValue | Date | undefined): AuditValue {
  if (value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The fields that differ between `before` and `after`, each side holding only
 * those. `null` when nothing changed, so the caller writes no entry.
 */
export function changedFields(
  before: Fields,
  after: Fields,
): { before: AuditValues; after: AuditValues } | null {
  const changed = Object.keys(after).filter(
    (key) => comparable(before[key]) !== comparable(after[key]),
  );
  if (changed.length === 0) {
    return null;
  }
  return {
    before: Object.fromEntries(changed.map((key) => [key, comparable(before[key])])),
    after: Object.fromEntries(changed.map((key) => [key, comparable(after[key])])),
  };
}

/** The fields a new entity was created with: those holding a value. */
export function createdFields(values: Fields): AuditValues {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, comparable(value)]),
  );
}

/** Appends `entry` to the audit log, as `actor`, in `tx`. */
export async function recordAudit(tx: Transaction, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    ...entry,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
}
