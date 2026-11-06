import { auditLog } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import type { AuditValues } from "#/lib/audit-fields.ts";

export { changedFields, createdFields } from "#/lib/audit-fields.ts";
export type { AuditValues } from "#/lib/audit-fields.ts";

// The one way to write the append-only audit log (ADR-0003). Every service
// that changes a patient's data, and later clinical records, calls it inside
// the change's own transaction, so the entry and the change commit together.
// An entry holds patient data: it is never logged.

export type AuditAction = "create" | "update" | "delete" | "deactivate" | "reactivate";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** The patient the entry is about, when there is one. */
  patientId: string | null;
  before: AuditValues | null;
  after: AuditValues | null;
}

/** Appends `entry` to the audit log, as `actor`, in `tx`. */
export async function recordAudit(tx: Transaction, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    ...entry,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
}
