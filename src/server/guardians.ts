import { and, asc, eq } from "drizzle-orm";

import { guardian, patient } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor, Role } from "#/lib/access.ts";
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

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";
import { lockPatient } from "#/server/patients.ts";

// A patient's guardians: contacts kept on the patient, not links to other
// patients. Reception, admins and practitioners add, edit and remove them, and
// choose who messages go to: the patient, or one guardian. Removing the
// guardian who is the contact falls back to the patient. Every change is
// written to the audit log about the patient, in its own transaction; a change
// of contact is an entry on the patient, naming the guardian. `database` is for
// tests, which pass a transaction running as the app role.

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

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

const editorRoles: readonly Role[] = ["admin", "receptionist", "practitioner"];

function canEdit(actor: Actor): boolean {
  return actor.roles.some((role) => editorRoles.includes(role));
}

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

async function findGuardian(tx: Transaction, guardianId: string) {
  const [found] = await tx
    .select(guardianColumns)
    .from(guardian)
    .where(eq(guardian.id, guardianId));
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
 * Finds a guardian and locks their patient, then reads the guardian again: a
 * change to them starts from the committed row, after any other change to the
 * patient's guardians.
 */
async function lockGuardian(tx: Transaction, guardianId: string) {
  const found = await findGuardian(tx, guardianId);
  if (!found || !(await lockPatient(tx, found.patientId))) {
    return undefined;
  }
  return findGuardian(tx, guardianId);
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
async function contactTarget(
  tx: Transaction,
  patientId: string,
  guardianId: string | null,
): Promise<Contact | undefined> {
  if (guardianId === null) {
    return patientContact;
  }
  const found = await findGuardian(tx, guardianId);
  return found?.patientId === patientId ? found : undefined;
}

async function currentContact(tx: Transaction, patientId: string): Promise<Contact> {
  const [found] = await tx
    .select({ id: guardian.id, name: guardian.name })
    .from(guardian)
    .where(and(eq(guardian.patientId, patientId), eq(guardian.messageContact, true)));
  return found ?? patientContact;
}

/**
 * Makes `to` the patient's contact in place of `from`, and writes the change
 * on the patient, each side by name. Nothing when they are the same.
 */
async function moveContact(
  tx: Transaction,
  actor: Actor,
  patientId: string,
  from: Contact,
  to: Contact,
) {
  if (from.id === to.id) {
    return;
  }
  await tx
    .update(guardian)
    .set({ messageContact: false })
    .where(and(eq(guardian.patientId, patientId), eq(guardian.messageContact, true)));
  if (to.id) {
    await tx.update(guardian).set({ messageContact: true }).where(eq(guardian.id, to.id));
  }
  await auditContact(tx, actor, patientId, from.name, to.name);
}

/** Writes a change of the patient's message contact, each side a guardian's name or `null`. */
async function auditContact(
  tx: Transaction,
  actor: Actor,
  patientId: string,
  before: string | null,
  after: string | null,
) {
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "patient",
    entityId: patientId,
    patientId,
    before: { messageContact: before },
    after: { messageContact: after },
  });
}

/** The patient's guardians, in the order they were added. */
export async function listGuardians(
  actor: Actor,
  input: { patientId: string },
  database?: AnyDatabase,
): Promise<Result<{ guardians: Guardian[] }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = messageContactChangeSchema.shape.patientId.safeParse(input.patientId);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      if (!(await patientExists(tx, parsed.data))) {
        return notFound;
      }
      const rows = await tx
        .select(guardianColumns)
        .from(guardian)
        .where(eq(guardian.patientId, parsed.data))
        .orderBy(asc(guardian.createdAt), asc(guardian.id));
      return { ok: true as const, guardians: rows };
    },
    database,
  );
}

export async function addGuardian(
  actor: Actor,
  input: GuardianInput,
  database?: AnyDatabase,
): Promise<Result<{ guardian: Guardian }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = guardianInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      if (!(await lockPatient(tx, parsed.data.patientId))) {
        return notFound;
      }
      const [created] = await tx
        .insert(guardian)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(guardianColumns);
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "guardian",
        entityId: created!.id,
        patientId: created!.patientId,
        before: null,
        after: createdFields(auditedValues(created!)),
      });
      return { ok: true as const, guardian: created! };
    },
    database,
  );
}

/** Replaces a guardian's fields with `input`'s. */
export async function updateGuardian(
  actor: Actor,
  input: GuardianUpdate,
  database?: AnyDatabase,
): Promise<Result<{ guardian: Guardian }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = guardianUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { guardianId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const current = await lockGuardian(tx, guardianId);
      if (!current) {
        return notFound;
      }
      const [updated] = await tx
        .update(guardian)
        .set(fields)
        .where(eq(guardian.id, guardianId))
        .returning(guardianColumns);
      const changed = changedFields(auditedValues(current), auditedValues(updated!));
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "guardian",
          entityId: guardianId,
          patientId: current.patientId,
          ...changed,
        });
      }
      return { ok: true as const, guardian: updated! };
    },
    database,
  );
}

/** Removes a guardian. When they were the message contact, messages go to the patient. */
export async function removeGuardian(
  actor: Actor,
  input: GuardianId,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = guardianIdSchema.safeParse(input);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const current = await lockGuardian(tx, parsed.data.guardianId);
      if (!current) {
        return notFound;
      }
      await tx.delete(guardian).where(eq(guardian.id, current.id));
      await recordAudit(tx, actor, {
        action: "delete",
        entityType: "guardian",
        entityId: current.id,
        patientId: current.patientId,
        before: createdFields(auditedValues(current)),
        after: null,
      });
      if (current.messageContact) {
        await auditContact(tx, actor, current.patientId, current.name, null);
      }
      return { ok: true as const };
    },
    database,
  );
}

/** Sends the patient's messages to one of their guardians, or to the patient when `null`. */
export async function setMessageContact(
  actor: Actor,
  input: MessageContactChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = messageContactChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, guardianId } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      if (!(await lockPatient(tx, patientId))) {
        return notFound;
      }
      const target = await contactTarget(tx, patientId, guardianId);
      if (target === undefined) {
        return notFound;
      }
      await moveContact(tx, actor, patientId, await currentContact(tx, patientId), target);
      return { ok: true as const };
    },
    database,
  );
}
