import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/**
 * The colour keys a medical service can take. They stand in for the brand palette until
 * it lands (#37): each draws from one of the theme's chart tokens.
 */
export const medicalServiceColors = ["color1", "color2", "color3", "color4", "color5"] as const;

export type MedicalServiceColor = (typeof medicalServiceColors)[number];

/** The swatch class of each colour key. */
export const medicalServiceColorClasses: Record<MedicalServiceColor, string> = {
  color1: "bg-chart-1",
  color2: "bg-chart-2",
  color3: "bg-chart-3",
  color4: "bg-chart-4",
  color5: "bg-chart-5",
};

export const medicalServiceColorLabels: Record<MedicalServiceColor, string> = {
  color1: "Color 1",
  color2: "Color 2",
  color3: "Color 3",
  color4: "Color 4",
  color5: "Color 5",
};

const medicalServiceFields = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: durationMinutesSchema,
  color: z.enum(medicalServiceColors),
});

/** A new medical service, shared by the form and the services. */
export const medicalServiceInputSchema = medicalServiceFields.extend({
  practitionerId: z.uuid(),
});

export const medicalServiceUpdateSchema = medicalServiceFields.extend({
  medicalServiceId: z.uuid(),
});

export const medicalServiceActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type MedicalServiceFields = z.input<typeof medicalServiceFields>;
export type MedicalServiceInput = z.input<typeof medicalServiceInputSchema>;
export type MedicalServiceUpdate = z.input<typeof medicalServiceUpdateSchema>;
export type MedicalServiceActiveChange = z.input<typeof medicalServiceActiveChangeSchema>;
