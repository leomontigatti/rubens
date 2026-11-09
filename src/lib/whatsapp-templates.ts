import * as z from "zod";

import { sampleAppointment, templateValues, variablesIn } from "#/lib/template-filling.ts";
import type { TemplateVariable } from "#/lib/template-filling.ts";

// The templates underthing starts conversations with (`docs/operations/whatsapp-templates.md`),
// each known by its name, and the rules a body is checked against before it
// is submitted to Meta (#154). A template is submitted in Spanish (Argentina),
// in the utility category, with named variables and no buttons.

/** Meta's code for Spanish (Argentina). */
export const templateLanguage = "es_AR";

/** A template's review at Meta, in Meta's words (lowercase); a submitted template starts pending. */
export const templateStatuses = ["pending", "approved", "rejected", "paused", "disabled"] as const;

export type TemplateStatus = (typeof templateStatuses)[number];

/** Our status for Meta's word for it; a word with no status here (`FLAGGED`, `IN_APPEAL`, …) has none. */
export function templateStatusOf(metaStatus: string): TemplateStatus | null {
  const status = metaStatus.toLowerCase();
  return (templateStatuses as readonly string[]).includes(status)
    ? (status as TemplateStatus)
    : null;
}

/** The longest body Meta accepts. */
const maxTemplateBodyLength = 1024;

const appointmentVariables = [
  "paciente",
  "profesional",
  "fecha",
  "hora",
  "sede",
  "direccion",
] as const;

/** Stands for the organization's sign-off in the drafts: the admin writes theirs in its place. */
const signOffPlaceholder = "[firma]";

interface TemplateDefinition {
  /** The variables the template may use. */
  variables: readonly TemplateVariable[];
  /** The doc's draft, which the admin starts from. */
  draft: string;
}

/** The set, in the doc's order, with the doc's drafts in `vos`. */
export const whatsappTemplates = {
  confirmacion_turno: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje. [firma]",
  },
  recordatorio_turno: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. ¿Nos confirmás tu asistencia? Si necesitás cancelarlo o cambiarlo, respondé este mensaje. [firma]",
  },
  recordatorio_turno_sin_confirmacion: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{sede}} ({{direccion}}). [firma]",
  },
  indicaciones: {
    variables: [...appointmentVariables, "indicaciones"],
    draft:
      "Hola {{paciente}}, te dejamos las indicaciones de {{profesional}} para después de tu turno: {{indicaciones}}. Cualquier duda, respondé este mensaje. [firma]",
  },
  seguimiento: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, ¿cómo te sentís después de tu turno del {{fecha}} con {{profesional}}? Contanos respondiendo este mensaje. [firma]",
  },
  turno_movido: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, tuvimos que mover tu turno con {{profesional}}: ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario. [firma]",
  },
  turno_cancelado: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario. [firma]",
  },
  turno_a_reprogramar: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario. [firma]",
  },
  solicitud_no_confirmada: {
    variables: appointmentVariables,
    draft:
      "Hola {{paciente}}, no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario. [firma]",
  },
  // Sent about a conversation, not an appointment: only the patient is known.
  reabrir_conversacion: {
    variables: ["paciente"],
    draft:
      "Hola {{paciente}}, tenemos una respuesta para vos. Respondé este mensaje para verla. [firma]",
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateName = keyof typeof whatsappTemplates;

export const templateNames = Object.keys(whatsappTemplates) as [TemplateName, ...TemplateName[]];

/** What the admin submits: a template of the set, and the body they wrote for it. */
export const templateSubmissionSchema = z.object({
  templateName: z.enum(templateNames),
  // Generous over Meta's limit, so the check, not the schema, names the length.
  body: z.string().max(maxTemplateBodyLength * 4),
});

export type TemplateSubmission = z.input<typeof templateSubmissionSchema>;

/** What keeps a body from being submitted, each a code the screen turns into what to fix. */
export type TemplateProblem =
  | { kind: "empty" }
  | { kind: "tooLong"; length: number }
  | { kind: "startsWithVariable" }
  | { kind: "endsWithVariable" }
  | { kind: "unnamedVariable"; variable: string }
  | { kind: "uppercaseVariable"; variable: string }
  | { kind: "invalidVariable"; variable: string }
  | { kind: "unknownVariable"; variable: string }
  | { kind: "strayBraces" }
  | { kind: "signOffPlaceholder" };

// Across lines too: Meta reads a variable split by a line break as one.
const variablePattern = /\{\{([\s\S]*?)\}\}/g;

const variableName = /^[a-z][a-z_]*$/;

function variableProblem(name: TemplateName, variable: string): TemplateProblem | null {
  if (/^\d+$/.test(variable)) {
    return { kind: "unnamedVariable", variable };
  }
  if (variable !== variable.toLowerCase() && variableName.test(variable.toLowerCase())) {
    return { kind: "uppercaseVariable", variable };
  }
  if (!variableName.test(variable)) {
    return { kind: "invalidVariable", variable };
  }
  const allowed: readonly string[] = whatsappTemplates[name].variables;
  return allowed.includes(variable) ? null : { kind: "unknownVariable", variable };
}

/**
 * Checks `body` against Meta's rules for template `name`: named variables
 * only, lowercase with underscores, each one the template fills; none at the
 * start or the end; at most 1,024 characters. The body is read trimmed, and
 * passes trimmed.
 */
export function checkTemplateBody(
  name: TemplateName,
  body: string,
): { ok: true; body: string } | { ok: false; problems: TemplateProblem[] } {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, problems: [{ kind: "empty" }] };
  }
  const problems: TemplateProblem[] = [];
  if (trimmed.length > maxTemplateBodyLength) {
    problems.push({ kind: "tooLong", length: trimmed.length });
  }
  if (/^\{\{[\s\S]*?\}\}/.test(trimmed)) {
    problems.push({ kind: "startsWithVariable" });
  }
  if (/\{\{[^{}]*\}\}$/.test(trimmed)) {
    problems.push({ kind: "endsWithVariable" });
  }
  for (const [, variable] of trimmed.matchAll(variablePattern)) {
    const problem = variableProblem(name, variable!);
    if (problem) {
      problems.push(problem);
    }
  }
  const outside = trimmed.replace(variablePattern, "");
  if (outside.includes("{{") || outside.includes("}}")) {
    problems.push({ kind: "strayBraces" });
  }
  if (trimmed.includes(signOffPlaceholder)) {
    problems.push({ kind: "signOffPlaceholder" });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, body: trimmed };
}

/** The name a version is submitted under at Meta, where each version is its own template. */
export function metaTemplateName(name: TemplateName, version: number) {
  return `${name}_v${version}`;
}

/** The version `metaName` is of template `name`, or `null` when it is not one of its versions. */
export function versionOf(name: TemplateName, metaName: string): number | null {
  const match = new RegExp(`^${name}_v([1-9]\\d*)$`).exec(metaName);
  return match ? Number(match[1]) : null;
}

/** Meta's example for each variable `body` uses, once each, in order, from the sample appointment. */
export function templateExamples(body: string) {
  const values = templateValues(sampleAppointment);
  return variablesIn(body).map((name) => ({ param_name: name, example: values[name] }));
}
