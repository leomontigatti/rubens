import * as z from "zod";

export const insurerKinds = ["obraSocial", "prepaga"] as const;

export type InsurerKind = (typeof insurerKinds)[number];

export const insurerKindLabels: Record<InsurerKind, string> = {
  obraSocial: "Obra social",
  prepaga: "Prepaga",
};

/** An insurer's fields, shared by the form and the services. */
export const insurerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(insurerKinds),
});

export const insurerUpdateSchema = insurerInputSchema.extend({ insurerId: z.uuid() });

export const insurerActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

const coverageFields = z.object({
  insurerId: z.uuid(),
  plan: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => (value ? value : null)),
  memberNumber: z.string().trim().min(1).max(100),
});

/**
 * A coverage's fields, shared by the form and the services. The patient's
 * first coverage is primary whatever `primary` says.
 */
export const coverageInputSchema = coverageFields.extend({
  patientId: z.uuid(),
  primary: z.boolean().default(false),
});

/** An edit to a coverage's fields. The primary flag moves on its own. */
export const coverageUpdateSchema = coverageFields.extend({ coverageId: z.uuid() });

export const coverageIdSchema = z.object({ coverageId: z.uuid() });

export type InsurerInput = z.input<typeof insurerInputSchema>;
export type InsurerUpdate = z.input<typeof insurerUpdateSchema>;
export type InsurerActiveChange = z.input<typeof insurerActiveChangeSchema>;
export type CoverageInput = z.input<typeof coverageInputSchema>;
export type CoverageUpdate = z.input<typeof coverageUpdateSchema>;
export type CoverageId = z.input<typeof coverageIdSchema>;

/** What a patient with no coverage shows: they pay privately. */
export const privateCoverageLabel = "Particular";

/** A coverage as a line of the patient page: "OSDE · 310". */
export function coverageLabel(coverage: { insurerName: string; plan: string | null }): string {
  return coverage.plan ? `${coverage.insurerName} · ${coverage.plan}` : coverage.insurerName;
}
