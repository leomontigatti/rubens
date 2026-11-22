import { isOneOf } from "#/lib/is-one-of.ts";
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
  "domicilio",
  "prestacion",
  // The address's name before `domicilio`, which a template Meta approved
  // then still carries: filled, but no new draft may use it (`whatsapp-templates.ts`).
  "direccion",
] as const;

export type TemplateVariable = (typeof templateVariableNames)[number];

export interface TemplateAppointment {
  patient: { firstName: string; chosenName: string | null };
  /** The practitioner, as the practitioner's rules name them. */
  practitionerName: string;
  start: Date;
  timeZone: string;
  officeName: string;
  officeAddress: string;
  medicalServiceName: string;
  /** The organization's name, which the text names instead of a sign-off. */
  organizationName: string;
}

export const sampleAppointment: Omit<TemplateAppointment, "organizationName"> = {
  patient: { firstName: "Lucía", chosenName: null },
  practitionerName: "la Dra. Sofía Méndez",
  start: new Date("2026-11-12T13:30:00Z"),
  timeZone: "America/Argentina/Buenos_Aires",
  officeName: "Sede Centro",
  officeAddress: "Av. Colón 1234, Córdoba",
  medicalServiceName: "Limpieza",
};

export function templateValues(appointment: TemplateAppointment): Record<TemplateVariable, string> {
  const { patient, start, timeZone } = appointment;
  return {
    paciente: patient.chosenName ?? patient.firstName,
    organizacion: appointment.organizationName,
    profesional: appointment.practitionerName,
    fecha: formatDay(start, timeZone),
    hora: formatTime(start, timeZone),
    sede: appointment.officeName,
    domicilio: appointment.officeAddress,
    prestacion: afterPossessive(appointment.medicalServiceName),
    direccion: appointment.officeAddress,
  };
}

/**
 * A medical service's name as a text reads it after `tu` or `su`
 * (`después de tu extracción`): its first letter lowercased, which a name
 * starting a sentence in the list (`Extracción`) is written with.
 */
function afterPossessive(name: string) {
  return name.charAt(0).toLocaleLowerCase("es") + name.slice(1);
}

const variablePattern = /\{\{([a-z_]+)\}\}/g;

function isTemplateVariable(name: string): name is TemplateVariable {
  return isOneOf(templateVariableNames, name);
}

export function variablesIn(body: string): TemplateVariable[] {
  const used = new Set<TemplateVariable>();
  for (const [, name] of body.matchAll(variablePattern)) {
    if (name !== undefined && isTemplateVariable(name)) {
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
