import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

const medicalServiceFields = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: durationMinutesSchema,
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
