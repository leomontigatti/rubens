import { and, asc, desc, eq } from "drizzle-orm";
import * as z from "zod";

import { auditLog, patient, user } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor, Role } from "#/lib/access.ts";
import {
  patientActiveChangeSchema,
  patientInputSchema,
  patientUpdateSchema,
  whatsappConsentChangeSchema,
} from "#/lib/patients.ts";
import type {
  DocumentType,
  PatientActiveChange,
  PatientInput,
  PatientUpdate,
  WhatsappConsentChange,
} from "#/lib/patients.ts";

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";
import type { AuditAction, AuditValues } from "#/server/audit.ts";

// The organization's patient registry. Reception, admins and practitioners
// register and edit patients; only an admin deactivates one or reads a
// patient's change history. Nothing is deleted. Every change is written to the
// audit log in its own transaction. `database` is for tests, which pass a
// transaction running as the app role.

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  chosenName: string | null;
  documentType: DocumentType | null;
  documentNumber: string | null;
  /** A local date, `YYYY-MM-DD`. */
  birthDate: string | null;
  /** E.164. */
  phone: string;
  email: string | null;
  address: string | null;
  whatsappConsent: boolean;
  whatsappConsentAt: Date;
  whatsappConsentBy: string;
  active: boolean;
  /** No birth date yet (ui: "Datos incompletos"). */
  incomplete: boolean;
}

export interface HistoryEntry {
  id: string;
  action: AuditAction;
  entityType: string;
  userId: string;
  /** `null` when the user is no longer found. */
  userName: string | null;
  before: AuditValues | null;
  after: AuditValues | null;
  createdAt: Date;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "documentTaken";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const documentTaken = { ok: false, reason: "documentTaken" } as const;

const patientIdSchema = z.uuid();

const editorRoles: readonly Role[] = ["admin", "receptionist", "practitioner"];

function canEdit(actor: Actor): boolean {
  return actor.roles.some((role) => editorRoles.includes(role));
}

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

const patientColumns = {
  id: patient.id,
  firstName: patient.firstName,
  lastName: patient.lastName,
  chosenName: patient.chosenName,
  documentType: patient.documentType,
  documentNumber: patient.documentNumber,
  birthDate: patient.birthDate,
  phone: patient.phone,
  email: patient.email,
  address: patient.address,
  whatsappConsent: patient.whatsappConsent,
  whatsappConsentAt: patient.whatsappConsentAt,
  whatsappConsentBy: patient.whatsappConsentBy,
  active: patient.active,
};

type PatientRow = Omit<Patient, "incomplete">;

function toPatient(row: PatientRow): Patient {
  return { ...row, incomplete: row.birthDate === null };
}

/**
 * The fields an audit entry records: the registration data. The id is the
 * entry's own, the active flag has its own actions, and when and by whom
 * consent was given is the entry's time and user.
 */
function auditedValues({
  id: _id,
  active: _active,
  whatsappConsentAt: _at,
  whatsappConsentBy: _by,
  ...values
}: PatientRow) {
  return values;
}

/** Whether `error` is the unique index on a patient's document refusing a repeat. */
function isDocumentTaken(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "constraint" in cause &&
    cause.constraint === "patient_document_unique"
  );
}

/**
 * Runs `work` under a savepoint, so a repeated document rolls back only the
 * write and the service can answer with a refusal; `null` then.
 */
async function unlessDocumentTaken<T>(
  tx: Transaction,
  work: (savepoint: Transaction) => Promise<T>,
): Promise<T | null> {
  try {
    return await tx.transaction(work);
  } catch (error) {
    if (isDocumentTaken(error)) {
      return null;
    }
    throw error;
  }
}

async function findPatient(tx: Transaction, patientId: string) {
  const [found] = await tx.select(patientColumns).from(patient).where(eq(patient.id, patientId));
  return found;
}

export interface ListOptions {
  includeInactive: boolean;
}

export async function listPatients(
  actor: Actor,
  options: ListOptions,
  database?: AnyDatabase,
): Promise<Result<{ patients: Patient[] }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select(patientColumns)
        .from(patient)
        .where(options.includeInactive ? undefined : eq(patient.active, true))
        .orderBy(asc(patient.lastName), asc(patient.firstName));
      return { ok: true as const, patients: rows.map(toPatient) };
    },
    database,
  );
}

export async function getPatient(
  actor: Actor,
  input: { patientId: string },
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPatient(tx, patientId.data);
      return found ? { ok: true as const, patient: toPatient(found) } : notFound;
    },
    database,
  );
}

export async function registerPatient(
  actor: Actor,
  input: PatientInput,
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = patientInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const created = await unlessDocumentTaken(tx, async (savepoint) => {
        const [row] = await savepoint
          .insert(patient)
          .values({
            ...parsed.data,
            organizationId: actor.organizationId,
            whatsappConsentAt: new Date(),
            whatsappConsentBy: actor.userId,
          })
          .returning(patientColumns);
        return row!;
      });
      if (!created) {
        return documentTaken;
      }
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "patient",
        entityId: created.id,
        patientId: created.id,
        before: null,
        after: createdFields(auditedValues(created)),
      });
      return { ok: true as const, patient: toPatient(created) };
    },
    database,
  );
}

/** Replaces a patient's registration data with `input`'s. */
export async function updatePatient(
  actor: Actor,
  input: PatientUpdate,
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = patientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const current = await findPatient(tx, patientId);
      if (!current) {
        return notFound;
      }
      const updated = await unlessDocumentTaken(tx, async (savepoint) => {
        const [row] = await savepoint
          .update(patient)
          .set(fields)
          .where(eq(patient.id, patientId))
          .returning(patientColumns);
        return row!;
      });
      if (!updated) {
        return documentTaken;
      }
      await auditUpdate(tx, actor, current, updated);
      return { ok: true as const, patient: toPatient(updated) };
    },
    database,
  );
}

async function auditUpdate(tx: Transaction, actor: Actor, before: PatientRow, after: PatientRow) {
  const changed = changedFields(auditedValues(before), auditedValues(after));
  if (!changed) {
    return;
  }
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "patient",
    entityId: after.id,
    patientId: after.id,
    ...changed,
  });
}

/**
 * Turns WhatsApp consent off when the patient asks, or back on, which records
 * who gave it and when, as registration does.
 */
export async function setWhatsappConsent(
  actor: Actor,
  input: WhatsappConsentChange,
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = whatsappConsentChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, whatsappConsent } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const current = await findPatient(tx, patientId);
      if (!current) {
        return notFound;
      }
      if (current.whatsappConsent === whatsappConsent) {
        return { ok: true as const, patient: toPatient(current) };
      }
      const [updated] = await tx
        .update(patient)
        .set(
          whatsappConsent
            ? { whatsappConsent, whatsappConsentAt: new Date(), whatsappConsentBy: actor.userId }
            : { whatsappConsent },
        )
        .where(eq(patient.id, patientId))
        .returning(patientColumns);
      await auditUpdate(tx, actor, current, updated!);
      return { ok: true as const, patient: toPatient(updated!) };
    },
    database,
  );
}

export async function setPatientActive(
  actor: Actor,
  input: PatientActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = patientActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const updated = await tx
        .update(patient)
        .set({ active })
        .where(and(eq(patient.id, id), eq(patient.active, !active)))
        .returning({ id: patient.id });
      if (updated.length === 0) {
        // Already in the state asked for, or not there at all.
        return (await findPatient(tx, id)) ? { ok: true as const } : notFound;
      }
      await recordAudit(tx, actor, {
        action: active ? "reactivate" : "deactivate",
        entityType: "patient",
        entityId: id,
        patientId: id,
        before: { active: !active },
        after: { active },
      });
      return { ok: true as const };
    },
    database,
  );
}

/** Every audit entry about a patient, newest first. */
export async function getPatientHistory(
  actor: Actor,
  input: { patientId: string },
  database?: AnyDatabase,
): Promise<Result<{ entries: HistoryEntry[] }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      if (!(await findPatient(tx, patientId.data))) {
        return notFound;
      }
      const rows = await tx
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entityType: auditLog.entityType,
          userId: auditLog.userId,
          userName: user.name,
          before: auditLog.before,
          after: auditLog.after,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.userId))
        .where(eq(auditLog.patientId, patientId.data))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id));
      return {
        ok: true as const,
        entries: rows.map((row) => ({ ...row, action: row.action as AuditAction })),
      };
    },
    database,
  );
}
