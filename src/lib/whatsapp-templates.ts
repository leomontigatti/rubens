import * as z from "zod";

import { hasEmoji, hasOpeningMark } from "#/lib/reply-checks.ts";
import { sampleAppointment, templateValues, variablesIn } from "#/lib/template-filling.ts";
import type { TemplateVariable } from "#/lib/template-filling.ts";
import { timingSchema } from "#/lib/template-timing.ts";

// The templates underthing starts conversations with (`docs/operations/whatsapp-templates.md`):
// the organization's own, which an admin creates, and the five event templates;
// and the rules a body is checked against before it is submitted to Meta
// (#154). A template is submitted in Spanish (Argentina), in the utility
// category, with named variables and no buttons.

/** Meta's code for Spanish (Argentina). */
export const templateLanguage = "es_AR";

/** A template's review at Meta, in Meta's words (lowercase); a submitted template starts pending. */
export const templateStatuses = ["pending", "approved", "rejected", "paused", "disabled"] as const;

export type TemplateStatus = (typeof templateStatuses)[number];

/**
 * A template's category at Meta (lowercase): every one is submitted as
 * utility, and only a utility version goes (`docs/operations/whatsapp-templates.md`).
 */
export const templateCategories = ["utility", "marketing", "authentication"] as const;

export type TemplateCategory = (typeof templateCategories)[number];

/** Our category for Meta's word for it, or `null` for a word underthing does not know. */
export function templateCategoryOf(metaCategory: string): TemplateCategory | null {
  const category = metaCategory.toLowerCase();
  return (templateCategories as readonly string[]).includes(category)
    ? (category as TemplateCategory)
    : null;
}

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
  "consultorio",
  "profesional",
  "fecha",
  "hora",
  "sede",
  "direccion",
] as const satisfies readonly TemplateVariable[];

/**
 * The five event templates, fixed and sent on their event, each stored under
 * its event's name as its id (docs/operations/whatsapp-templates.md § Event
 * templates).
 */
export const eventTemplateIds = [
  "turno_movido",
  "turno_cancelado",
  "turno_a_reprogramar",
  "solicitud_no_confirmada",
  "reabrir_conversacion",
] as const;

export type EventTemplateId = (typeof eventTemplateIds)[number];

export function isEventTemplate(templateId: string): templateId is EventTemplateId {
  return (eventTemplateIds as readonly string[]).includes(templateId);
}

/**
 * The variables template `templateId` may use: the organization's name and
 * every fact of the appointment, except in `reabrir_conversacion`, sent about a
 * conversation, where only the patient and the organization are known.
 */
export function templateVariables(templateId: string | null): readonly TemplateVariable[] {
  return templateId === "reabrir_conversacion" ? ["paciente", "consultorio"] : appointmentVariables;
}

/** The longest name an admin gives a template. */
const maxTemplateNameLength = 80;

const templateNameSchema = z.string().trim().min(1).max(maxTemplateNameLength);

// Generous over Meta's limit, so the check, not the schema, names the length.
const bodySchema = z.string().max(maxTemplateBodyLength * 4);

/** A new template of the organization's own, which its creation submits to Meta. */
export const templateCreateSchema = z.object({
  name: templateNameSchema,
  timing: timingSchema,
  body: bodySchema,
});

/**
 * An edit of template `templateId`: its text, which goes to Meta when it
 * changed, and for one of the organization's own its name and timing, which
 * an event template has neither of.
 */
export const templateEditSchema = z.object({
  templateId: z.string().min(1).max(64),
  body: bodySchema,
  settings: z.object({ name: templateNameSchema, timing: timingSchema }).nullable(),
});

export const templateDeleteSchema = z.object({ templateId: z.uuid() });

export type TemplateCreate = z.input<typeof templateCreateSchema>;
export type TemplateEdit = z.input<typeof templateEditSchema>;
export type TemplateDelete = z.input<typeof templateDeleteSchema>;

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
  | { kind: "openingMark" }
  | { kind: "emoji" };

// Across lines too: Meta reads a variable split by a line break as one.
const variablePattern = /\{\{([\s\S]*?)\}\}/g;

const variableName = /^[a-z][a-z_]*$/;

function variableProblem(
  allowed: readonly TemplateVariable[],
  variable: string,
): TemplateProblem | null {
  if (/^\d+$/.test(variable)) {
    return { kind: "unnamedVariable", variable };
  }
  if (variable !== variable.toLowerCase() && variableName.test(variable.toLowerCase())) {
    return { kind: "uppercaseVariable", variable };
  }
  if (!variableName.test(variable)) {
    return { kind: "invalidVariable", variable };
  }
  return (allowed as readonly string[]).includes(variable)
    ? null
    : { kind: "unknownVariable", variable };
}

/**
 * Checks `body` against Meta's rules, with `allowed` the variables its
 * template may use: named variables only, lowercase with underscores, each one
 * the template fills; none at the start or the end; at most 1,024
 * characters; and the assistant's fixed checks (`reply-checks.ts`): no opening
 * `¿` or `¡`, no emoji. The body is read trimmed, and passes trimmed.
 */
export function checkTemplateBody(
  allowed: readonly TemplateVariable[],
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
    const problem = variableProblem(allowed, variable!);
    if (problem) {
      problems.push(problem);
    }
  }
  const outside = trimmed.replace(variablePattern, "");
  if (outside.includes("{{") || outside.includes("}}")) {
    problems.push({ kind: "strayBraces" });
  }
  if (hasOpeningMark(trimmed)) {
    problems.push({ kind: "openingMark" });
  }
  if (hasEmoji(trimmed)) {
    problems.push({ kind: "emoji" });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, body: trimmed };
}

/**
 * The name template `templateId`'s versions take at Meta, where each version
 * is its own template: an event template's own name, or for one of the
 * organization's, `t_` and its id, which renaming it leaves alone.
 */
function metaBaseName(templateId: string) {
  return isEventTemplate(templateId) ? templateId : `t_${templateId.replaceAll("-", "")}`;
}

/** The name `version` of template `templateId` is submitted under at Meta. */
export function metaTemplateName(templateId: string, version: number) {
  return `${metaBaseName(templateId)}_v${version}`;
}

/** The version `metaName` is of template `templateId`, or `null` when it is not one of its versions. */
export function versionOf(templateId: string, metaName: string): number | null {
  const match = new RegExp(`^${metaBaseName(templateId)}_v([1-9]\\d*)$`).exec(metaName);
  return match ? Number(match[1]) : null;
}

/**
 * Meta's example for each variable `body` uses, once each, in order, from the
 * sample appointment and the name of the organization `organizationName`.
 */
export function templateExamples(body: string, organizationName: string) {
  const values = templateValues({ ...sampleAppointment, organizationName });
  return variablesIn(body).map((name) => ({ param_name: name, example: values[name] }));
}
