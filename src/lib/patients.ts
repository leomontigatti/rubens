import * as z from "zod";

import { appointmentStatusLabels, cancellerLabels } from "#/lib/appointment-statuses.ts";
import { practiceTimeZone } from "#/lib/dates.ts";
import { toPersonLastName, toPersonName } from "#/lib/person-names.ts";
import { formatPhone, parsePhoneEntry } from "#/lib/phones.ts";
import { formatDateTime, formatLocalDate } from "#/lib/dates.ts";
import { today } from "#/lib/schedules.ts";

export const documentTypes = ["dni", "passport", "other"] as const;

export type DocumentType = (typeof documentTypes)[number];

const nameText = z.string().trim().min(1).max(200);

/** A first name, or a guardian's name. */
export const personName = nameText.transform(toPersonName);

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
}

export const phoneEntrySchema = z.object({ country: z.string(), number: z.string() });

/** A phone field's entry read into E.164; the issue's message is the phone's refusal. */
export const phoneSchema = phoneEntrySchema.transform((value, context) => {
  const result = parsePhoneEntry(value);
  if (!result.ok) {
    context.addIssue({ code: "custom", message: result.reason });
    return z.NEVER;
  }
  return result.phone;
});

const patientFields = z.object({
  firstName: personName,
  lastName: nameText.transform(toPersonLastName),
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
    .transform((value, context) => {
      if (!value) {
        return null;
      }
      // The organization's offices are all in Argentina, so its date is the
      // default zone's, on the browser's clock and on the server's.
      const problem = birthDateProblem(value, today(practiceTimeZone));
      if (problem) {
        context.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return value;
    }),
  email: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  address: optionalText(500),
});

export const documentFields = {
  documentType: patientFields.shape.documentType,
  documentNumber: patientFields.shape.documentNumber,
};

interface DocumentFields {
  documentType: DocumentType | null;
  documentNumber: string | null;
}

export function normalizeDocument<T extends DocumentFields>(
  fields: T,
  context: z.RefinementCtx,
): T {
  if ((fields.documentType === null) !== (fields.documentNumber === null)) {
    context.addIssue({ code: "custom", path: ["documentNumber"], message: "documentIncomplete" });
    return z.NEVER;
  }
  if (fields.documentNumber === null) {
    return fields;
  }
  const documentNumber = fields.documentNumber.replace(/[.\s-]/g, "").toUpperCase();
  if (fields.documentType === "dni" && !/^\d{6,9}$/.test(documentNumber)) {
    context.addIssue({ code: "custom", path: ["documentNumber"], message: "invalidDni" });
    return z.NEVER;
  }
  if (documentNumber === "") {
    context.addIssue({ code: "custom", path: ["documentNumber"], message: "documentIncomplete" });
    return z.NEVER;
  }
  return { ...fields, documentNumber };
}

export const patientInputSchema = patientFields.transform(normalizeDocument);

export const patientUpdateSchema = patientFields
  .extend({ patientId: z.uuid() })
  .transform(normalizeDocument);

export const whatsappConsentChangeSchema = z.object({
  patientId: z.uuid(),
  whatsappConsent: z.boolean(),
});

/** A decision on a patient an opt-out-looking reply held, made under that reply. */
export const optOutDecisionSchema = whatsappConsentChangeSchema.extend({ messageId: z.uuid() });

export const patientActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export const patientReferenceSchema = patientActiveChangeSchema.pick({ id: true });

export type PatientInput = z.input<typeof patientInputSchema>;

export interface DuplicateConfirmation {
  confirmDuplicates?: boolean;
}
export type PatientUpdate = z.input<typeof patientUpdateSchema>;
export type WhatsappConsentChange = z.input<typeof whatsappConsentChangeSchema>;
export type OptOutDecision = z.input<typeof optOutDecisionSchema>;
export type PatientActiveChange = z.input<typeof patientActiveChangeSchema>;
export type PatientReference = z.input<typeof patientReferenceSchema>;

export function patientName(patient: {
  firstName: string;
  lastName: string;
  chosenName: string | null;
}): string {
  return `${patient.chosenName ?? patient.firstName} ${patient.lastName}`;
}

export function isMinor(birthDate: string | null, today: string): boolean {
  if (birthDate === null) {
    return false;
  }
  // Zero-padded dates compare as strings.
  const coming = `${String(Number(birthDate.slice(0, 4)) + 18).padStart(4, "0")}${birthDate.slice(4)}`;
  return today < coming;
}

function birthDateProblem(
  birthDate: string,
  today: string,
): "futureBirthDate" | "birthDateTooOld" | null {
  if (birthDate > today) {
    return "futureBirthDate";
  }
  const oldest = `${String(Number(today.slice(0, 4)) - 100).padStart(4, "0")}${today.slice(4)}`;
  return birthDate < oldest ? "birthDateTooOld" : null;
}

/** The badges a patient shows by their name. */
export function patientBadges(patient: {
  incompletePatient: boolean;
  minor: boolean;
  whatsappConsent: boolean;
}) {
  return [
    ...(patient.incompletePatient ? [{ label: "Incompleto", variant: "warning" as const }] : []),
    ...(patient.minor ? [{ label: "Menor de edad", variant: "outline" as const }] : []),
    // `info`, like the alert its page shows.
    ...(patient.whatsappConsent ? [] : [{ label: "Sin WhatsApp", variant: "info" as const }]),
  ];
}

/** How many patients the list shows at a time. */
export const patientPageSize = 25;

export const documentTypeLabels: Record<DocumentType, string> = {
  dni: "DNI",
  passport: "Pasaporte",
  other: "Otro",
};

export function documentLabel(patient: {
  documentType: DocumentType | null;
  documentNumber: string | null;
}): string | null {
  if (!patient.documentType || !patient.documentNumber) {
    return null;
  }
  return `${documentTypeLabels[patient.documentType]} ${patient.documentNumber}`;
}

// A guardian's name and relationship come first: its other fields are a patient's.
const fieldLabelsInFormOrder: Record<string, string> = {
  name: "Nombre",
  relationship: "Relación",
  firstName: "Nombre",
  lastName: "Apellido",
  phone: "Teléfono",
  chosenName: "Apodo",
  documentType: "Tipo de documento",
  documentNumber: "Número de documento",
  birthDate: "Fecha de nacimiento",
  email: "Correo electrónico",
  address: "Domicilio",
  whatsappConsent: "Acepta WhatsApp",
  optOutPending: "Pedido de baja sin decidir",
  // A coverage's, in its form's order.
  insurer: "Obra social / prepaga",
  plan: "Plan",
  memberNumber: "Número de afiliado",
  primary: "Principal",
  messageContact: "Recibe los mensajes",
  start: "Inicio",
  end: "Fin",
  practitionerId: "Profesional",
  medicalServiceId: "Prestación",
  roomId: "Consultorio",
  overbooking: "Sobreturno",
  status: "Estado",
  cancelledBy: "Canceló",
  cancellationReason: "Motivo de cancelación",
  receptionNote: "Nota de recepción",
};

const fieldOrder = Object.keys(fieldLabelsInFormOrder);

function fieldRank(field: string): number {
  const rank = fieldOrder.indexOf(field);
  return rank === -1 ? fieldOrder.length : rank;
}

type HistoryValue = string | number | boolean | null | undefined;

interface HistoryContext {
  names: Readonly<Record<string, string>>;
  timeZone: string;
}

const byName = (id: string, context: HistoryContext) => context.names[id] ?? "Desconocido";

const localDateTime = (instant: string, context: HistoryContext) =>
  formatDateTime(new Date(instant), context.timeZone);

const formatters: Record<string, (text: string, context: HistoryContext) => string> = {
  phone: formatPhone,
  birthDate: formatLocalDate,
  documentType: (text) => documentTypeLabels[text as DocumentType] ?? text,
  start: localDateTime,
  end: localDateTime,
  practitionerId: byName,
  medicalServiceId: byName,
  roomId: byName,
  status: (text) => appointmentStatusLabels[text as keyof typeof appointmentStatusLabels] ?? text,
  cancelledBy: (text) => cancellerLabels[text as keyof typeof cancellerLabels] ?? text,
};

function formatValue(field: string, value: HistoryValue, context: HistoryContext): string {
  if (field === "messageContact") {
    return value === null || value === undefined ? "El paciente" : String(value);
  }
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }
  const formatter = formatters[field];
  return formatter ? formatter(String(value), context) : String(value);
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

// Recorded for the log, not shown: a coverage's insurer shows by its name, and
// an appointment's patient is the page's.
// `active` too: an archive's or a restore's entry already says so in its action.
const hiddenFields = new Set(["insurerId", "patientId", "active"]);

/**
 * An audit entry's changed fields, labelled and formatted for the change
 * history: ids by their `names`.
 */
export function historyChanges(
  entry: {
    before: Record<string, HistoryValue> | null;
    after: Record<string, HistoryValue> | null;
  },
  names: Readonly<Record<string, string>> = {},
): FieldChange[] {
  const context = { names, timeZone: practiceTimeZone };
  const fields = Object.keys({ ...entry.before, ...entry.after })
    .filter((field) => !hiddenFields.has(field))
    .sort((a, b) => fieldRank(a) - fieldRank(b));
  return fields.map((field) => ({
    field: fieldLabelsInFormOrder[field] ?? field,
    before: formatValue(field, entry.before?.[field], context),
    after: formatValue(field, entry.after?.[field], context),
  }));
}

const actionLabels = {
  create: "Alta",
  update: "Cambio",
  delete: "Baja",
  deactivate: "Archivado",
  reactivate: "Restauración",
} as const;

const entityLabels: Record<string, string> = {
  appointment: " de turno",
  coverage: " de cobertura",
  guardian: " de responsable",
};

/**
 * A change history entry's title: its action and what it is about, an
 * appointment by its time and practitioner as it is now.
 */
export function historyTitle(entry: {
  action: keyof typeof actionLabels;
  entityType: string;
  appointment: { startsAt: number; practitioner: string } | null;
}): string {
  const action = actionLabels[entry.action];
  const { appointment } = entry;
  if (appointment) {
    const when = formatDateTime(appointment.startsAt, practiceTimeZone);
    return `${action} del turno del ${when} con ${appointment.practitioner}`;
  }
  return `${action}${entityLabels[entry.entityType] ?? ""}`;
}
