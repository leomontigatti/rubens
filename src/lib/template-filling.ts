import { formatDay, formatTime } from "#/lib/dates.ts";

// Filling a WhatsApp template from an appointment
// (`docs/operations/whatsapp-templates.md`): the values underthing puts in each
// variable, the text the patient reads, and the parameters Meta is sent. The
// object fills a template it sends from the appointment's current state; the
// template preview fills it from `sampleAppointment`.

/** Each variable underthing fills, in the doc's order. */
const templateVariableNames = [
  "paciente",
  "organizacion",
  "profesional",
  "fecha",
  "hora",
  "sede",
  "direccion",
] as const;

export type TemplateVariable = (typeof templateVariableNames)[number];

/** What a template is filled from: an appointment, joined to its patient, practitioner and office. */
export interface TemplateAppointment {
  patient: { firstName: string; chosenName: string | null };
  /** The practitioner, as the practitioner's rules name them. */
  practitionerName: string;
  start: Date;
  /** The office's IANA zone, where the day and the time are read. */
  timeZone: string;
  officeName: string;
  officeAddress: string;
  /** The organization's name, which the text names instead of a sign-off. */
  organizationName: string;
}

/** The appointment the template preview and Meta's examples are filled from. */
export const sampleAppointment: Omit<TemplateAppointment, "organizationName"> = {
  patient: { firstName: "Lucía", chosenName: null },
  practitionerName: "la Dra. Sofía Méndez",
  // A Thursday, at 10:30 in Buenos Aires.
  start: new Date("2026-11-12T13:30:00Z"),
  timeZone: "America/Argentina/Buenos_Aires",
  officeName: "Sede Centro",
  officeAddress: "Av. Colón 1234, Córdoba",
};

/** The value of each variable for `appointment`. */
export function templateValues(appointment: TemplateAppointment): Record<TemplateVariable, string> {
  const { patient, start, timeZone } = appointment;
  return {
    paciente: patient.chosenName ?? patient.firstName,
    organizacion: appointment.organizationName,
    profesional: appointment.practitionerName,
    fecha: formatDay(start, timeZone),
    hora: formatTime(start, timeZone),
    sede: appointment.officeName,
    direccion: appointment.officeAddress,
  };
}

const variablePattern = /\{\{([a-z_]+)\}\}/g;

function isTemplateVariable(name: string): name is TemplateVariable {
  return (templateVariableNames as readonly string[]).includes(name);
}

/** The variables `body` uses, once each, in the order they first appear. */
export function variablesIn(body: string): TemplateVariable[] {
  const used = new Set<TemplateVariable>();
  for (const [, name] of body.matchAll(variablePattern)) {
    if (isTemplateVariable(name!)) {
      used.add(name);
    }
  }
  return [...used];
}

/**
 * `body` filled from `values`: the text the patient reads, and Meta's value
 * for each variable it uses, once each, in order. A body passed the template
 * rules check, so every variable in it is one of its template's, which
 * `values` holds: those of an appointment (`templateValues`), or the
 * patient's name alone for `reabrir_conversacion`.
 */
export function fillTemplate(body: string, values: Partial<Record<TemplateVariable, string>>) {
  const valueOf = (name: TemplateVariable) => values[name] ?? "";
  return {
    text: body.replace(variablePattern, (whole, name: string) =>
      isTemplateVariable(name) ? valueOf(name) : whole,
    ),
    parameters: variablesIn(body).map((name) => ({ name, value: valueOf(name) })),
  };
}

/**
 * `body` as the template preview shows it: trimmed, as it is submitted, and
 * filled from `sampleAppointment` and the name of the organization `organizationName`.
 */
export function fillSample(body: string, organizationName: string) {
  return fillTemplate(body.trim(), templateValues({ ...sampleAppointment, organizationName })).text;
}
