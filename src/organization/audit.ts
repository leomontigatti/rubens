import type { AuditValues } from "#/lib/audit-fields.ts";

import type { Writer } from "#/organization/database.ts";
import { auditLog } from "#/organization/schema.ts";

// The one way to write the append-only audit log (ADR-0003, ADR-0008). Every
// change calls it inside the change's own transaction, so the entry and the
// change commit or roll back together. Nothing in the object updates or
// deletes an entry. An entry holds patient data: it is never logged.

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

/** Appends `entry` to the audit log, as `userId`, in `writer`'s transaction. */
export function recordAudit(writer: Writer, userId: string, entry: AuditEntry): void {
  writer
    .insert(auditLog)
    .values({ ...entry, userId })
    .run();
}
