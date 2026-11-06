import { and, asc, eq, sql } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import {
  guardianIdSchema,
  guardianInputSchema,
  guardianUpdateSchema,
  messageContactChangeSchema,
} from "#/lib/guardians.ts";
import type {
  GuardianId,
  GuardianInput,
  GuardianUpdate,
  MessageContactChange,
} from "#/lib/guardians.ts";
import type { DocumentType } from "#/lib/patients.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPatient } from "#/organization/patients.ts";
import { guardian } from "#/organization/schema.ts";

// A patient's guardians: contacts kept on the patient, not links to other
// patients. Reception, admins and practitioners add, edit and remove them, and
// choose who messages go to: the patient, or one guardian. Removing the
// guardian who is the contact falls back to the patient. Every change is
// written to the audit log about the patient, in its own transaction; a change
// of contact is an entry on the patient, naming the guardian.

export interface Guardian {
  id: string;
  patientId: string;
  name: string;
  relationship: string;
  documentType: DocumentType | null;
  documentNumber: string | null;
  /** E.164. */
  phone: string;
  email: string | null;
  /** Whether messages to the patient go to this guardian. */
  messageContact: boolean;
}

type Refusal = "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

const guardianColumns = {
  id: guardian.id,
  patientId: guardian.patientId,
  name: guardian.name,
  relationship: guardian.relationship,
  documentType: guardian.documentType,
  documentNumber: guardian.documentNumber,
  phone: guardian.phone,
  email: guardian.email,
  messageContact: guardian.messageContact,
};

/** The fields a guardian's own entries record; the contact has the patient's. */
function auditedValues({
  id: _id,
  patientId: _patientId,
  messageContact: _contact,
  ...values
}: Guardian) {
  return values;
}

function findGuardian(writer: Writer, guardianId: string) {
  return writer.select(guardianColumns).from(guardian).where(eq(guardian.id, guardianId)).get();
}

/** Who messages go to: a guardian, by id and name, or the patient, both `null`. */
interface Contact {
  id: string | null;
  name: string | null;
}

const patientContact: Contact = { id: null, name: null };

/**
 * The contact `guardianId` names, `null` being the patient; `undefined` when
 * it is not one of the patient's guardians.
 */
function contactTarget(
  writer: Writer,
  patientId: string,
  guardianId: string | null,
): Contact | undefined {
  if (guardianId === null) {
    return patientContact;
  }
  const found = findGuardian(writer, guardianId);
  return found?.patientId === patientId ? found : undefined;
}

function currentContact(writer: Writer, patientId: string): Contact {
  const found = writer
    .select({ id: guardian.id, name: guardian.name })
    .from(guardian)
    .where(and(eq(guardian.patientId, patientId), eq(guardian.messageContact, true)))
    .get();
  return found ?? patientContact;
}

/** Writes a change of the patient's message contact, each side a guardian's name or `null`. */
function auditContact(
  writer: Writer,
  acting: Acting,
  patientId: string,
  before: string | null,
  after: string | null,
) {
  recordAudit(writer, acting.userId, {
    action: "update",
    entityType: "patient",
    entityId: patientId,
    patientId,
    before: { messageContact: before },
    after: { messageContact: after },
  });
}

/** The patient's guardians, in the order they were added. */
export function listGuardians(
  database: Database,
  input: { patientId: string },
): Result<{ guardians: Guardian[] }> {
  const parsed = messageContactChangeSchema.shape.patientId.safeParse(input.patientId);
  if (!parsed.success || !findPatient(database, parsed.data)) {
    return notFound;
  }
  const guardians = database
    .select(guardianColumns)
    .from(guardian)
    .where(eq(guardian.patientId, parsed.data))
    // Two can share a millisecond.
    .orderBy(asc(guardian.createdAt), asc(sql`${guardian}.rowid`))
    .all();
  return { ok: true, guardians };
}

export function addGuardian(
  database: Database,
  acting: Acting,
  input: GuardianInput,
): Result<{ guardian: Guardian }> {
  const parsed = guardianInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    if (!findPatient(tx, parsed.data.patientId)) {
      return notFound;
    }
    const created = tx.insert(guardian).values(parsed.data).returning(guardianColumns).get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "guardian",
      entityId: created.id,
      patientId: created.patientId,
      before: null,
      after: createdFields(auditedValues(created)),
    });
    return { ok: true as const, guardian: created };
  });
}

/** Replaces a guardian's fields with `input`'s. */
export function updateGuardian(
  database: Database,
  acting: Acting,
  input: GuardianUpdate,
): Result<{ guardian: Guardian }> {
  const parsed = guardianUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { guardianId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = findGuardian(tx, guardianId);
    if (!current) {
      return notFound;
    }
    const updated = tx
      .update(guardian)
      .set(fields)
      .where(eq(guardian.id, guardianId))
      .returning(guardianColumns)
      .get();
    const changed = changedFields(auditedValues(current), auditedValues(updated));
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "guardian",
        entityId: guardianId,
        patientId: current.patientId,
        ...changed,
      });
    }
    return { ok: true as const, guardian: updated };
  });
}

/** Removes a guardian. When they were the message contact, messages go to the patient. */
export function removeGuardian(
  database: Database,
  acting: Acting,
  input: GuardianId,
): Result<object> {
  const parsed = guardianIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return database.transaction((tx) => {
    const current = findGuardian(tx, parsed.data.guardianId);
    if (!current) {
      return notFound;
    }
    tx.delete(guardian).where(eq(guardian.id, current.id)).run();
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "guardian",
      entityId: current.id,
      patientId: current.patientId,
      before: createdFields(auditedValues(current)),
      after: null,
    });
    if (current.messageContact) {
      auditContact(tx, acting, current.patientId, current.name, null);
    }
    return { ok: true as const };
  });
}

/** Sends the patient's messages to one of their guardians, or to the patient when `null`. */
export function setMessageContact(
  database: Database,
  acting: Acting,
  input: MessageContactChange,
): Result<object> {
  const parsed = messageContactChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, guardianId } = parsed.data;
  return database.transaction((tx) => {
    if (!findPatient(tx, patientId)) {
      return notFound;
    }
    const target = contactTarget(tx, patientId, guardianId);
    if (target === undefined) {
      return notFound;
    }
    const from = currentContact(tx, patientId);
    if (from.id === target.id) {
      return { ok: true as const };
    }
    tx.update(guardian)
      .set({ messageContact: false })
      .where(and(eq(guardian.patientId, patientId), eq(guardian.messageContact, true)))
      .run();
    if (target.id) {
      tx.update(guardian).set({ messageContact: true }).where(eq(guardian.id, target.id)).run();
    }
    auditContact(tx, acting, patientId, from.name, target.name);
    return { ok: true as const };
  });
}
