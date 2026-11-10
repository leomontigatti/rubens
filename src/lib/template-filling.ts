// Filling a WhatsApp template from an appointment
// (`docs/operations/whatsapp-templates.md`): the values underthing puts in each
// variable, the text the patient reads, and the parameters Meta is sent. The
// object fills a template it sends from the appointment's current state; the
// template preview fills it from `sampleAppointment`.

/** Each variable underthing fills, in the doc's order. */
const templateVariableNames = [
  "paciente",
  "profesional",
  "fecha",
  "hora",
  "sede",
  "direccion",
  "indicaciones",
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
  /** The medical service's care instructions, when it has them. */
  careInstructions: string | null;
}

/** The appointment the template preview and Meta's examples are filled from. */
export const sampleAppointment: TemplateAppointment = {
  patient: { firstName: "Lucía", chosenName: null },
  practitionerName: "la Dra. Sofía Méndez",
  // A Thursday, at 10:30 in Buenos Aires.
  start: new Date("2026-11-12T13:30:00Z"),
  timeZone: "America/Argentina/Buenos_Aires",
  officeName: "Sede Centro",
  officeAddress: "Av. Colón 1234, Córdoba",
  careInstructions: "evitá el sol directo por 48 horas",
};

/** The day as the templates write it, such as `jueves 12 de noviembre`. */
export function appointmentDay(start: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value;
  return `${part("weekday")} ${part("day")} de ${part("month")}`;
}

/** The time on a 24-hour clock, such as `09:05`. */
export function appointmentTime(start: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(start);
}

/** The value of each variable for `appointment`. */
export function templateValues(appointment: TemplateAppointment): Record<TemplateVariable, string> {
  const { patient, start, timeZone } = appointment;
  return {
    paciente: patient.chosenName ?? patient.firstName,
    profesional: appointment.practitionerName,
    fecha: appointmentDay(start, timeZone),
    hora: appointmentTime(start, timeZone),
    sede: appointment.officeName,
    direccion: appointment.officeAddress,
    indicaciones: appointment.careInstructions ?? "",
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
 * Care instructions as they go in `{{indicaciones}}` (decided in #162): Meta
 * refuses a value with a line break, a tab or a run of spaces, so each line
 * break is joined as `; ` and each run of other whitespace becomes one space.
 */
export function flattenCareInstructions(text: string) {
  return text
    .split(/[\n\r\v\f\u2028\u2029]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ");
}
