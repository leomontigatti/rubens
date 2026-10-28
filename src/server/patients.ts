import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";
import * as z from "zod";

import { auditLog, patient, user } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor, Role } from "#/lib/access.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  isMinor,
  patientActiveChangeSchema,
  patientInputSchema,
  patientUpdateSchema,
  whatsappConsentChangeSchema,
} from "#/lib/patients.ts";
import { parsePhone } from "#/lib/phones.ts";
import { today } from "#/lib/schedules.ts";
import type {
  DocumentType,
  DuplicateConfirmation,
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
// audit log in its own transaction. Registering, and an edit to a patient's
// names, phone, document or birth date, run the duplicate check first.
// `database` is for tests, which pass a transaction running as the app role.

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
  /** Under 18 today in the organization's time zone; never with no birth date. */
  minor: boolean;
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

/** Why a registration or an edit matched an existing patient. */
export type DuplicateMatch = "phone" | "nameAndBirthDate";

export interface DuplicateCandidate {
  patient: Patient;
  matches: DuplicateMatch[];
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

/**
 * The duplicate check's answers: the document blocks, naming its holder; a
 * phone or a name and birth date only warn, until the caller confirms.
 */
export type DuplicateRefusal =
  | { ok: false; reason: "documentTaken"; patient: Patient }
  | { ok: false; reason: "possibleDuplicates"; candidates: DuplicateCandidate[] };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

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

type PatientRow = Omit<Patient, "incomplete" | "minor">;

// The organization's offices are all in Argentina, so its date is the default
// zone's.
function toPatient(row: PatientRow): Patient {
  return {
    ...row,
    incomplete: row.birthDate === null,
    minor: isMinor(row.birthDate, today(defaultTimeZone)),
  };
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

async function findPatient(tx: Transaction, patientId: string) {
  const [found] = await tx.select(patientColumns).from(patient).where(eq(patient.id, patientId));
  return found;
}

/** The fields the duplicate check reads, as the patient schemas output them. */
interface DuplicateFields {
  firstName: string;
  lastName: string;
  phone: string;
  documentType: DocumentType | null;
  documentNumber: string | null;
  birthDate: string | null;
}

/** Whether an edit changes a field the duplicate check reads. */
function changesDuplicateFields(before: DuplicateFields, after: DuplicateFields): boolean {
  return (
    ["firstName", "lastName", "phone", "documentType", "documentNumber", "birthDate"] as const
  ).some((field) => before[field] !== after[field]);
}

/**
 * Runs the duplicate check for `fields`, leaving out the patient `exceptId`
 * (the one being edited). The unique index on the document backs the first
 * step; this lookup is what names the holder.
 */
async function checkDuplicates(
  tx: Transaction,
  fields: DuplicateFields,
  options: { exceptId?: string; confirmed: boolean },
): Promise<DuplicateRefusal | null> {
  const others = options.exceptId ? ne(patient.id, options.exceptId) : undefined;
  if (fields.documentType && fields.documentNumber) {
    const [holder] = await tx
      .select(patientColumns)
      .from(patient)
      .where(
        and(
          others,
          eq(patient.documentType, fields.documentType),
          eq(patient.documentNumber, fields.documentNumber),
        ),
      );
    if (holder) {
      return { ok: false, reason: "documentTaken", patient: toPatient(holder) };
    }
  }
  if (options.confirmed) {
    return null;
  }
  const samePhone = eq(patient.phone, fields.phone);
  const sameName =
    fields.birthDate === null
      ? sql`false`
      : sql`(${patient.birthDate} = ${fields.birthDate} and rubens.normalize_text(${patient.firstName} || ' ' || ${patient.lastName}) = rubens.normalize_text(${`${fields.firstName} ${fields.lastName}`}))`;
  const rows = await tx
    .select({
      ...patientColumns,
      samePhone: sql<boolean>`${samePhone}`,
      sameName: sql<boolean>`${sameName}`,
    })
    .from(patient)
    .where(and(others, or(samePhone, sameName)))
    .orderBy(asc(patient.lastName), asc(patient.firstName));
  if (rows.length === 0) {
    return null;
  }
  const candidates = rows.map(({ samePhone: phone, sameName: name, ...row }) => ({
    patient: toPatient(row),
    matches: [phone && "phone", name && "nameAndBirthDate"].filter(
      (match): match is DuplicateMatch => typeof match === "string",
    ),
  }));
  return { ok: false, reason: "possibleDuplicates", candidates };
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

export const searchLimit = 20;

const searchOptionsSchema = z.object({
  query: z.string().max(200),
  includeInactive: z.boolean(),
});

export type SearchOptions = z.input<typeof searchOptionsSchema>;

/** The names a search matches, normalized as the index on them (0008). */
const searchName = sql`rubens.patient_search_name(${patient.firstName}, ${patient.lastName}, ${patient.chosenName})`;

/**
 * What a typed query looks for: its words, matched against the names; and,
 * when it is only digits and separators, those digits and the phone it reads
 * as. Words keep only letters and digits, so none is a `like` wildcard.
 */
function searchTerms(query: string) {
  const words = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const digits = query.replace(/[\s.()+-]/g, "");
  if (!/^\d+$/.test(digits)) {
    return { words, digits: null, phone: null };
  }
  const phone = parsePhone(query);
  return { words, digits, phone: phone.ok ? phone.phone : null };
}

/**
 * Finds patients as reception types: every word of the query in any of their
 * names, in any order and with or without accents, a near miss included;
 * digits in their document or phone too. Best matches first.
 */
export async function searchPatients(
  actor: Actor,
  options: SearchOptions,
  database?: AnyDatabase,
): Promise<Result<{ patients: Patient[] }>> {
  if (!canEdit(actor)) {
    return forbidden;
  }
  const parsed = searchOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return invalidInput;
  }
  const { words, digits, phone } = searchTerms(parsed.data.query);
  if (words.length === 0) {
    return { ok: true, patients: [] };
  }
  const nameMatches = and(
    ...words.map(
      (word) =>
        sql`(${searchName} like '%' || rubens.normalize_text(${word}) || '%' or rubens.normalize_text(${word}) operator(public.<%) ${searchName})`,
    ),
  );
  const digitMatches = digits
    ? or(
        like(patient.documentNumber, `%${digits}%`),
        like(patient.phone, `%${digits}%`),
        phone ? eq(patient.phone, phone) : undefined,
      )
    : undefined;
  const exact = digits
    ? sql`${patient.documentNumber} = ${digits} or ${patient.phone} = ${phone ?? digits}`
    : sql`false`;
  const score = sql`case when ${exact} then 1 else public.similarity(rubens.normalize_text(${words.join(" ")}), ${searchName}) end`;
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select(patientColumns)
        .from(patient)
        .where(
          and(
            parsed.data.includeInactive ? undefined : eq(patient.active, true),
            or(nameMatches, digitMatches),
          ),
        )
        .orderBy(desc(score), asc(patient.lastName), asc(patient.firstName))
        .limit(searchLimit);
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
  input: PatientInput & DuplicateConfirmation,
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }> | DuplicateRefusal> {
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
      const duplicates = await checkDuplicates(tx, parsed.data, {
        confirmed: input.confirmDuplicates === true,
      });
      if (duplicates) {
        return duplicates;
      }
      const [created] = await tx
        .insert(patient)
        .values({
          ...parsed.data,
          organizationId: actor.organizationId,
          whatsappConsentAt: new Date(),
          whatsappConsentBy: actor.userId,
        })
        .returning(patientColumns);
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "patient",
        entityId: created!.id,
        patientId: created!.id,
        before: null,
        after: createdFields(auditedValues(created!)),
      });
      return { ok: true as const, patient: toPatient(created!) };
    },
    database,
  );
}

/**
 * Replaces a patient's registration data with `input`'s. An edit that changes
 * a field the duplicate check reads is checked again.
 */
export async function updatePatient(
  actor: Actor,
  input: PatientUpdate & DuplicateConfirmation,
  database?: AnyDatabase,
): Promise<Result<{ patient: Patient }> | DuplicateRefusal> {
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
      if (changesDuplicateFields(current, fields)) {
        const duplicates = await checkDuplicates(tx, fields, {
          exceptId: patientId,
          confirmed: input.confirmDuplicates === true,
        });
        if (duplicates) {
          return duplicates;
        }
      }
      const [updated] = await tx
        .update(patient)
        .set(fields)
        .where(eq(patient.id, patientId))
        .returning(patientColumns);
      await auditUpdate(tx, actor, current, updated!);
      return { ok: true as const, patient: toPatient(updated!) };
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
