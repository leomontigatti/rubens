import { and, asc, eq, ne, sql } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import {
  insurerActiveChangeSchema,
  insurerInputSchema,
  insurerUpdateSchema,
} from "#/lib/coverages.ts";
import type {
  InsurerActiveChange,
  InsurerInput,
  InsurerKind,
  InsurerUpdate,
} from "#/lib/coverages.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { insurer } from "#/organization/schema.ts";

// The organization's list of insurers, which coverages are picked from. Only
// an admin changes it (the object's requirement); every member reads it.
// Nothing is deleted: a deactivated insurer drops out of the default list and
// stays on the coverages that have it. Every change is written to the audit
// log, about no patient.

export interface Insurer {
  id: string;
  name: string;
  kind: InsurerKind;
  active: boolean;
}

type Refusal = "invalidInput" | "notFound" | "nameTaken";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const nameTaken = { ok: false, reason: "nameTaken" } as const;

const insurerColumns = {
  id: insurer.id,
  name: insurer.name,
  kind: insurer.kind,
  active: insurer.active,
};

/** Whether another insurer has `name`, whatever its case (`insurer_name_unique`). */
function isNameTaken(writer: Writer, name: string, exceptId?: string): boolean {
  const found = writer
    .select({ id: insurer.id })
    .from(insurer)
    .where(
      and(
        sql`lower(${insurer.name}) = lower(${name})`,
        exceptId === undefined ? undefined : ne(insurer.id, exceptId),
      ),
    )
    .get();
  return found !== undefined;
}

export interface InsurerListOptions {
  includeInactive: boolean;
}

export function listInsurers(
  database: Database,
  options: InsurerListOptions,
): { ok: true; insurers: Insurer[] } {
  const insurers = database
    .select(insurerColumns)
    .from(insurer)
    .where(options.includeInactive ? undefined : eq(insurer.active, true))
    .orderBy(asc(insurer.name))
    .all();
  return { ok: true, insurers };
}

export function createInsurer(
  database: Database,
  acting: Acting,
  input: InsurerInput,
): Result<{ insurer: Insurer }> {
  const parsed = insurerInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    if (isNameTaken(tx, parsed.data.name)) {
      return nameTaken;
    }
    const created = tx.insert(insurer).values(parsed.data).returning(insurerColumns).get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "insurer",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(parsed.data),
    });
    return { ok: true as const, insurer: created };
  });
}

export function updateInsurer(
  database: Database,
  acting: Acting,
  input: InsurerUpdate,
): Result<{ insurer: Insurer }> {
  const parsed = insurerUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { insurerId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = tx.select(insurerColumns).from(insurer).where(eq(insurer.id, insurerId)).get();
    if (!current) {
      return notFound;
    }
    if (isNameTaken(tx, fields.name, insurerId)) {
      return nameTaken;
    }
    const updated = tx
      .update(insurer)
      .set(fields)
      .where(eq(insurer.id, insurerId))
      .returning(insurerColumns)
      .get();
    const changed = changedFields(current, fields);
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "insurer",
        entityId: insurerId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, insurer: updated };
  });
}

export function setInsurerActive(
  database: Database,
  acting: Acting,
  input: InsurerActiveChange,
): Result<object> {
  const parsed = insurerActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return database.transaction((tx) => {
    const current = tx
      .select({ active: insurer.active })
      .from(insurer)
      .where(eq(insurer.id, id))
      .get();
    if (!current) {
      return notFound;
    }
    if (current.active === active) {
      return { ok: true as const };
    }
    tx.update(insurer).set({ active }).where(eq(insurer.id, id)).run();
    recordAudit(tx, acting.userId, {
      action: active ? "reactivate" : "deactivate",
      entityType: "insurer",
      entityId: id,
      patientId: null,
      before: { active: !active },
      after: { active },
    });
    return { ok: true as const };
  });
}
