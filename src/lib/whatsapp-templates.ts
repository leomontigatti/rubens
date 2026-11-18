import * as z from "zod";

import { isOneOf } from "#/lib/is-one-of.ts";
import { hasEmoji, hasOpeningMark } from "#/lib/reply-checks.ts";
import { sampleAppointment, templateValues, variablesIn } from "#/lib/template-filling.ts";
import type { TemplateVariable } from "#/lib/template-filling.ts";
import { timingSchema } from "#/lib/template-timing.ts";

// The templates underthing starts conversations with (`docs/operations/whatsapp-templates.md`):
// the organization's own, which an admin creates, and the four event templates;
// and the rules a body is checked against before it is submitted to Meta (#154).

export const templateLanguage = "es_AR";

/** A template's review at Meta, in Meta's words (lowercase); a submitted template starts pending. */
export const templateStatuses = ["pending", "approved", "rejected", "paused", "disabled"] as const;

export type TemplateStatus = (typeof templateStatuses)[number];

export const templateCategories = ["utility", "marketing", "authentication"] as const;

export type TemplateCategory = (typeof templateCategories)[number];

export function templateCategoryOf(metaCategory: string): TemplateCategory | null {
  const category = metaCategory.toLowerCase();
  return isOneOf(templateCategories, category) ? category : null;
}

export function templateStatusOf(metaStatus: string): TemplateStatus | null {
  const status = metaStatus.toLowerCase();
  return isOneOf(templateStatuses, status) ? status : null;
}

const maxTemplateBodyLength = 1024;

const appointmentVariables = [
  "paciente",
  "organizacion",
  "profesional",
  "fecha",
  "hora",
  "sede",
  "direccion",
  "prestacion",
] as const satisfies readonly TemplateVariable[];

export const eventTemplateIds = [
  "turno_movido",
  "turno_no_disponible",
  "solicitud_no_confirmada",
  "reabrir_conversacion",
] as const;

export type EventTemplateId = (typeof eventTemplateIds)[number];

export function isEventTemplate(templateId: string): templateId is EventTemplateId {
  return isOneOf(eventTemplateIds, templateId);
}

/**
 * A template's quick-reply buttons (ADR-0014): none, the two that confirm the
 * appointment or ask to change it, or the one that shows a reply waiting.
 */
export const templateButtonKinds = ["none", "confirm", "reopen"] as const;

export type TemplateButtons = (typeof templateButtonKinds)[number];

export const ownTemplateButtonKinds = [
  "none",
  "confirm",
] as const satisfies readonly TemplateButtons[];

/** Each kind's labels, in the patient's voice and the same in either `Trato`; the first is the one code acts on. */
export const templateButtonLabels = {
  none: [],
  confirm: ["Sí, voy", "Necesito cambiarlo"],
  reopen: ["Ver respuesta"],
} as const satisfies Record<TemplateButtons, readonly string[]>;

export function eventTemplateButtons(templateId: EventTemplateId): TemplateButtons {
  if (templateId === "turno_movido") {
    return "confirm";
  }
  return templateId === "reabrir_conversacion" ? "reopen" : "none";
}

/**
 * The variables template `templateId` may use: the organization's name and
 * every fact of the appointment, except in `reabrir_conversacion`, sent about a
 * conversation, where only the patient and the organization are known.
 */
export function templateVariables(templateId: string | null): readonly TemplateVariable[] {
  return templateId === "reabrir_conversacion"
    ? ["paciente", "organizacion"]
    : appointmentVariables;
}

const maxTemplateNameLength = 80;

const templateNameSchema = z.string().trim().min(1).max(maxTemplateNameLength);

// Generous over Meta's limit, so the check, not the schema, names the length.
const bodySchema = z.string().max(maxTemplateBodyLength * 4);

export const templateCreateSchema = z.object({
  name: templateNameSchema,
  timing: timingSchema,
  body: bodySchema,
  buttons: z.enum(ownTemplateButtonKinds).default("none"),
});

/**
 * An edit of template `templateId`: its text, which goes to Meta when it
 * changed, and for one of the organization's own its name and timing, which
 * an event template has neither of.
 */
export const templateEditSchema = z.object({
  templateId: z.string().min(1).max(64),
  body: bodySchema,
  settings: z
    .object({
      name: templateNameSchema,
      timing: timingSchema,
      /** Its buttons; a change submits the text again with them. Absent keeps the ones it has. */
      buttons: z.enum(ownTemplateButtonKinds).optional(),
    })
    .nullable(),
});

export const templateDeleteSchema = z.object({ templateId: z.uuid() });

export const templateReviewRequestSchema = z.object({
  body: bodySchema.trim().min(1),
});

export type TemplateCreate = z.input<typeof templateCreateSchema>;
export type TemplateEdit = z.input<typeof templateEditSchema>;
export type TemplateDelete = z.input<typeof templateDeleteSchema>;
export type TemplateReviewRequest = z.input<typeof templateReviewRequestSchema>;

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
  return isOneOf(allowed, variable) ? null : { kind: "unknownVariable", variable };
}

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

function metaBaseName(templateId: string) {
  return isEventTemplate(templateId) ? templateId : `t_${templateId.replaceAll("-", "")}`;
}

export function metaTemplateName(templateId: string, version: number) {
  return `${metaBaseName(templateId)}_v${version}`;
}

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
