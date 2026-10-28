import * as z from "zod";

import { formatPhone, parsePhone } from "#/lib/phones.ts";
import { formatLocalDate } from "#/lib/schedules.ts";

export const documentTypes = ["dni", "passport", "other"] as const;

export type DocumentType = (typeof documentTypes)[number];

const name = z.string().trim().min(1).max(200);

/** An optional text field: an empty one is no value. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
}

/** A typed phone, read into E.164; the issue's message is the phone's refusal. */
const phoneSchema = z.string().transform((value, context) => {
  const result = parsePhone(value);
  if (!result.ok) {
    context.addIssue({ code: "custom", message: result.reason });
    return z.NEVER;
  }
  return result.phone;
});

const patientFields = z.object({
  firstName: name,
  lastName: name,
  phone: phoneSchema,
  chosenName: optionalText(200),
  documentType: z
    .enum(documentTypes)
    .nullish()
    .transform((value) => value ?? null),
  documentNumber: optionalText(50),
  birthDate: z.iso
    .date()
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  email: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  address: optionalText(500),
});

type PatientFields = z.output<typeof patientFields>;

/**
 * A document is a type and a number together, or neither. A DNI is kept as its
 * digits, so "30.123.456" and "30123456" are the same document.
 */
function normalizeDocument<T extends PatientFields>(fields: T, context: z.RefinementCtx): T {
  if ((fields.documentType === null) !== (fields.documentNumber === null)) {
    context.addIssue({ code: "custom", path: ["documentNumber"], message: "documentIncomplete" });
    return z.NEVER;
  }
  if (fields.documentType === "dni" && fields.documentNumber !== null) {
    const digits = fields.documentNumber.replace(/[.\s-]/g, "");
    if (!/^\d{6,9}$/.test(digits)) {
      context.addIssue({ code: "custom", path: ["documentNumber"], message: "invalidDni" });
      return z.NEVER;
    }
    return { ...fields, documentNumber: digits };
  }
  return fields;
}

/**
 * A patient's registration data, shared by the form and the services. Only the
 * names and the phone are required: the rest is completed at the first visit.
 */
export const patientInputSchema = patientFields.transform(normalizeDocument);

export const patientUpdateSchema = patientFields
  .extend({ patientId: z.uuid() })
  .transform(normalizeDocument);

export const whatsappConsentChangeSchema = z.object({
  patientId: z.uuid(),
  whatsappConsent: z.boolean(),
});

export const patientActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type PatientInput = z.input<typeof patientInputSchema>;

/**
 * Sent with a registration or an edit to save it although the duplicate check
 * warned of a likely duplicate, as siblings sharing a phone are.
 */
export interface DuplicateConfirmation {
  confirmDuplicates?: boolean;
}
export type PatientUpdate = z.input<typeof patientUpdateSchema>;
export type WhatsappConsentChange = z.input<typeof whatsappConsentChangeSchema>;
export type PatientActiveChange = z.input<typeof patientActiveChangeSchema>;

/**
 * The name the app calls a patient by: their chosen first name in place of the
 * legal one when they have one, the "nombre de pila adoptado" of Ley 26.743.
 */
export function patientName(patient: {
  firstName: string;
  lastName: string;
  chosenName: string | null;
}): string {
  return `${patient.chosenName ?? patient.firstName} ${patient.lastName}`;
}

/** The legal name, for the patient's details and documents. */
export function legalName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`;
}

export const documentTypeLabels: Record<DocumentType, string> = {
  dni: "DNI",
  passport: "Pasaporte",
  other: "Otro",
};

/** A patient's document as the patient page shows it: "DNI 30123456". */
export function documentLabel(patient: {
  documentType: DocumentType | null;
  documentNumber: string | null;
}): string | null {
  if (!patient.documentType || !patient.documentNumber) {
    return null;
  }
  return `${documentTypeLabels[patient.documentType]} ${patient.documentNumber}`;
}

// In the registration form's order, which the change history follows, then a
// coverage's.
const fieldLabels: Record<string, string> = {
  firstName: "Nombre",
  lastName: "Apellido",
  phone: "Teléfono",
  chosenName: "Nombre autopercibido",
  documentType: "Tipo de documento",
  documentNumber: "Número de documento",
  birthDate: "Fecha de nacimiento",
  email: "Correo electrónico",
  address: "Dirección",
  whatsappConsent: "Acepta WhatsApp",
  active: "Activo",
  // A coverage's, in its form's order.
  insurer: "Obra social / prepaga",
  plan: "Plan",
  memberNumber: "Número de afiliado",
  primary: "Principal",
};

const fieldOrder = Object.keys(fieldLabels);

/** A field's place in the form; one the form lacks goes last. */
function fieldRank(field: string): number {
  const rank = fieldOrder.indexOf(field);
  return rank === -1 ? fieldOrder.length : rank;
}

type HistoryValue = string | number | boolean | null | undefined;

function formatValue(field: string, value: HistoryValue): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }
  const text = String(value);
  if (field === "phone") {
    return formatPhone(text);
  }
  if (field === "birthDate") {
    return formatLocalDate(text);
  }
  if (field === "documentType") {
    return documentTypeLabels[text as DocumentType] ?? text;
  }
  return text;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

/** An audit entry's changed fields, labelled and formatted for the change history. */
export function historyChanges(entry: {
  before: Record<string, HistoryValue> | null;
  after: Record<string, HistoryValue> | null;
}): FieldChange[] {
  // The log's JSON keeps no key order, so the form's order is restored here.
  const fields = Object.keys({ ...entry.before, ...entry.after }).sort(
    (a, b) => fieldRank(a) - fieldRank(b),
  );
  return fields.map((field) => ({
    field: fieldLabels[field] ?? field,
    before: formatValue(field, entry.before?.[field]),
    after: formatValue(field, entry.after?.[field]),
  }));
}
