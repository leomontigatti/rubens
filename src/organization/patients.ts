import { and, asc, count, eq, ne, or } from "drizzle-orm";
import * as z from "zod";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  isMinor,
  patientActiveChangeSchema,
  patientInputSchema,
  patientPageSize,
  patientUpdateSchema,
  whatsappConsentChangeSchema,
  optOutDecisionSchema,
} from "#/lib/patients.ts";
import { today } from "#/lib/schedules.ts";
import type {
  DocumentType,
  DuplicateConfirmation,
  PatientActiveChange,
  PatientInput,
  PatientUpdate,
  WhatsappConsentChange,
  OptOutDecision,
} from "#/lib/patients.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { isHeldUnder, liftOptOutHold, optOutPendingSince } from "#/organization/opt-out-holds.ts";
import { dropQueuedForPatient, requeueForPatient } from "#/organization/outbox.ts";
import { normalizeText, wordsOf } from "#/lib/search-text.ts";
import { coverage, insurer, patient } from "#/organization/schema.ts";
import { relinkPatient } from "#/organization/whatsapp-messages.ts";

// The organization's patient registry. Reception, admins and practitioners
// register and edit patients; only an admin deactivates one (the object's
// requirements). Nothing is deleted. Every change is written to the audit log
// in its own transaction. Registering, and an edit to a patient's names,
// phone, document or birth date, run the duplicate check first.

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
  /** Unix milliseconds. */
  whatsappConsentAt: number;
  whatsappConsentBy: string;
  active: boolean;
  /** No birth date yet (ui: "Datos incompletos"). */
  incomplete: boolean;
  /** Under 18 today in the organization's time zone; never with no birth date. */
  minor: boolean;
}

/** A patient as a list shows them; a private patient has no insurer. */
export type ListedPatient = Patient & { insurerName: string | null };

/** Why a registration or an edit matched an existing patient. */
export type DuplicateMatch = "phone" | "nameAndBirthDate";

export interface DuplicateCandidate {
  patient: Patient;
  matches: DuplicateMatch[];
}

type Refusal = "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

/**
 * The duplicate check's answers: the document blocks, naming its holder; a
 * phone or a name and birth date only warn, until the caller confirms.
 */
export type DuplicateRefusal =
  | { ok: false; reason: "documentTaken"; patient: Patient }
  | { ok: false; reason: "possibleDuplicates"; candidates: DuplicateCandidate[] };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

export const patientIdSchema = z.uuid();

export const patientColumns = {
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
export function toPatient<Row extends PatientRow>(row: Row) {
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

/**
 * The names the search box matches: the words of the legal names and the
 * chosen name, normalized, one space apart.
 */
function searchNameOf(fields: { firstName: string; lastName: string; chosenName: string | null }) {
  return wordsOf(
    normalizeText(`${fields.firstName} ${fields.lastName} ${fields.chosenName ?? ""}`),
  ).join(" ");
}

export function findPatient(writer: Writer, patientId: string) {
  return writer.select(patientColumns).from(patient).where(eq(patient.id, patientId)).get();
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

const fullName = (fields: { firstName: string; lastName: string }) =>
  normalizeText(`${fields.firstName} ${fields.lastName}`);

/**
 * Runs the duplicate check for `fields`, leaving out the patient `exceptId`
 * (the one being edited). The unique index on the document backs the first
 * step; this lookup is what names the holder.
 */
function checkDuplicates(
  writer: Writer,
  fields: DuplicateFields,
  options: { exceptId?: string; confirmed: boolean },
): DuplicateRefusal | null {
  const others = options.exceptId ? ne(patient.id, options.exceptId) : undefined;
  if (fields.documentType && fields.documentNumber) {
    const holder = writer
      .select(patientColumns)
      .from(patient)
      .where(
        and(
          others,
          eq(patient.documentType, fields.documentType),
          eq(patient.documentNumber, fields.documentNumber),
        ),
      )
      .get();
    if (holder) {
      return { ok: false, reason: "documentTaken", patient: toPatient(holder) };
    }
  }
  if (options.confirmed) {
    return null;
  }
  // The names are compared in code, normalized as the search reads them.
  const name = fullName(fields);
  const candidates = writer
    .select(patientColumns)
    .from(patient)
    .where(
      and(
        others,
        or(
          eq(patient.phone, fields.phone),
          fields.birthDate === null ? undefined : eq(patient.birthDate, fields.birthDate),
        ),
      ),
    )
    .orderBy(asc(patient.lastName), asc(patient.firstName))
    .all()
    .map((row) => ({
      patient: toPatient(row),
      matches: [
        row.phone === fields.phone && "phone",
        fields.birthDate !== null &&
          row.birthDate === fields.birthDate &&
          fullName(row) === name &&
          "nameAndBirthDate",
      ].filter((match): match is DuplicateMatch => typeof match === "string"),
    }))
    .filter((candidate) => candidate.matches.length > 0);
  return candidates.length === 0 ? null : { ok: false, reason: "possibleDuplicates", candidates };
}

const listOptionsSchema = z.object({
  includeInactive: z.boolean(),
  page: z.number().int().positive().default(1),
});

export type PatientListOptions = z.input<typeof listOptionsSchema>;

export interface PatientPage {
  patients: ListedPatient[];
  total: number;
  page: number;
  /** The default list shows none, yet some patients exist, all inactive. */
  onlyInactive: boolean;
}

/** Patients with their primary insurer: at most one coverage is primary, so a patient is one row. */
function selectListedPatients(database: Database) {
  return database
    .select({ ...patientColumns, insurerName: insurer.name })
    .from(patient)
    .leftJoin(coverage, and(eq(coverage.patientId, patient.id), eq(coverage.primary, true)))
    .leftJoin(insurer, eq(insurer.id, coverage.insurerId));
}

/** One page of the registry; a page past the end answers with the last one. */
export function listPatients(database: Database, options: PatientListOptions): Result<PatientPage> {
  const parsed = listOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return invalidInput;
  }
  const shown = parsed.data.includeInactive ? undefined : eq(patient.active, true);
  const { total } = database.select({ total: count() }).from(patient).where(shown).get() ?? {
    total: 0,
  };
  const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / patientPageSize)));
  const rows = selectListedPatients(database)
    .where(shown)
    .orderBy(asc(patient.lastName), asc(patient.firstName), asc(patient.id))
    .limit(patientPageSize)
    .offset((page - 1) * patientPageSize)
    .all();
  const onlyInactive =
    !parsed.data.includeInactive &&
    total === 0 &&
    database.select({ id: patient.id }).from(patient).limit(1).get() !== undefined;
  return { ok: true, patients: rows.map(toPatient), total, page, onlyInactive };
}

export function getPatient(
  database: Database,
  input: { patientId: string },
): Result<{ patient: Patient; optOutPendingSince: number | null }> {
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success) {
    return notFound;
  }
  const found = findPatient(database, patientId.data);
  if (!found) {
    return notFound;
  }
  const optOutPending = optOutPendingSince(database, found.id);
  return { ok: true, patient: toPatient(found), optOutPendingSince: optOutPending };
}

export function registerPatient(
  database: Database,
  acting: Acting,
  input: PatientInput & DuplicateConfirmation,
): Result<{ patient: Patient }> | DuplicateRefusal {
  const parsed = patientInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    const duplicates = checkDuplicates(tx, parsed.data, {
      confirmed: input.confirmDuplicates === true,
    });
    if (duplicates) {
      return duplicates;
    }
    const created = tx
      .insert(patient)
      .values({
        ...parsed.data,
        searchName: searchNameOf(parsed.data),
        whatsappConsentAt: Date.now(),
        whatsappConsentBy: acting.userId,
      })
      .returning(patientColumns)
      .get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "patient",
      entityId: created.id,
      patientId: created.id,
      before: null,
      after: createdFields(auditedValues(created)),
    });
    relinkPatient(tx, created.id);
    return { ok: true as const, patient: toPatient(created) };
  });
}

/**
 * Replaces a patient's registration data with `input`'s. An edit that changes
 * a field the duplicate check reads is checked again.
 */
export function updatePatient(
  database: Database,
  acting: Acting,
  input: PatientUpdate & DuplicateConfirmation,
): Result<{ patient: Patient }> | DuplicateRefusal {
  const parsed = patientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = findPatient(tx, patientId);
    if (!current) {
      return notFound;
    }
    if (changesDuplicateFields(current, fields)) {
      const duplicates = checkDuplicates(tx, fields, {
        exceptId: patientId,
        confirmed: input.confirmDuplicates === true,
      });
      if (duplicates) {
        return duplicates;
      }
    }
    const updated = tx
      .update(patient)
      .set({ ...fields, searchName: searchNameOf(fields) })
      .where(eq(patient.id, patientId))
      .returning(patientColumns)
      .get();
    auditUpdate(tx, acting, current, updated);
    if (updated.phone !== current.phone) {
      relinkPatient(tx, patientId);
    }
    return { ok: true as const, patient: toPatient(updated) };
  });
}

function auditUpdate(writer: Writer, acting: Acting, before: PatientRow, after: PatientRow) {
  const changed = changedFields(auditedValues(before), auditedValues(after));
  if (!changed) {
    return;
  }
  recordAudit(writer, acting.userId, {
    action: "update",
    entityType: "patient",
    entityId: after.id,
    patientId: after.id,
    ...changed,
  });
}

/**
 * Turns WhatsApp consent off when the patient asks, or back on, which records
 * who gave it and when, as registration does. Either answers an
 * opt-out-looking reply that holds the patient (`opt-out-holds.ts`): off drops
 * their held messages with the rest, and on while consent is on keeps the
 * patient, whose held messages then go, read again as they are by then.
 */
export function setWhatsappConsent(
  database: Database,
  acting: Acting,
  input: WhatsappConsentChange,
): Result<{ patient: Patient }> {
  const parsed = whatsappConsentChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, whatsappConsent } = parsed.data;
  return database.transaction((tx) => changeConsent(tx, acting, patientId, whatsappConsent));
}

/**
 * Decides on a patient the reply `messageId` held, under it in the
 * conversation: as `setWhatsappConsent`, refused once someone decided, so a
 * page loaded before that changes nothing.
 */
export function decideOptOut(
  database: Database,
  acting: Acting,
  input: OptOutDecision,
): Result<object> | { ok: false; reason: "decided" } {
  const parsed = optOutDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { patientId, messageId, whatsappConsent } = parsed.data;
  return database.transaction((tx) => {
    if (!isHeldUnder(tx, patientId, messageId)) {
      return { ok: false as const, reason: "decided" as const };
    }
    const changed = changeConsent(tx, acting, patientId, whatsappConsent);
    return changed.ok ? { ok: true as const } : changed;
  });
}

function changeConsent(
  tx: Writer,
  acting: Acting,
  patientId: string,
  whatsappConsent: boolean,
): Result<{ patient: Patient }> {
  const current = findPatient(tx, patientId);
  if (!current) {
    return notFound;
  }
  const held = liftOptOutHold(tx, acting, patientId, whatsappConsent);
  if (current.whatsappConsent === whatsappConsent) {
    if (held) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "patient",
        entityId: patientId,
        patientId,
        before: { optOutPending: true },
        after: { optOutPending: false },
      });
    }
    return { ok: true as const, patient: toPatient(current) };
  }
  return { ok: true as const, patient: applyConsent(tx, acting, current, whatsappConsent) };
}

/** Turns `current`'s consent to `whatsappConsent`, which differs: their queued messages go or are dropped. */
function applyConsent(tx: Writer, acting: Acting, current: PatientRow, whatsappConsent: boolean) {
  const updated = tx
    .update(patient)
    .set(
      whatsappConsent
        ? { whatsappConsent, whatsappConsentAt: Date.now(), whatsappConsentBy: acting.userId }
        : { whatsappConsent },
    )
    .where(eq(patient.id, current.id))
    .returning(patientColumns)
    .get();
  if (whatsappConsent) {
    requeueForPatient(tx, current.id);
  } else {
    dropQueuedForPatient(tx, current.id);
  }
  auditUpdate(tx, acting, current, updated);
  return toPatient(updated);
}

// Deactivating a patient sends their future appointments to the
// to-reschedule list once appointments port (#138).
export function setPatientActive(
  database: Database,
  acting: Acting,
  input: PatientActiveChange,
): Result<object> {
  const parsed = patientActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return database.transaction((tx) => {
    const current = findPatient(tx, id);
    if (!current) {
      return notFound;
    }
    if (current.active === active) {
      return { ok: true as const };
    }
    tx.update(patient).set({ active }).where(eq(patient.id, id)).run();
    recordAudit(tx, acting.userId, {
      action: active ? "reactivate" : "deactivate",
      entityType: "patient",
      entityId: id,
      patientId: id,
      before: { active: !active },
      after: { active },
    });
    return { ok: true as const };
  });
}
