import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/** The most reminders a medical service sends: templates timed before the appointment. */
export const maxReminders = 5;

const maxCutoffHours = 720;

const templateIdsSchema = z
  .array(z.uuid())
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const rescheduleCutoffHoursSchema = z.int().min(0).max(maxCutoffHours);

const medicalServiceFields = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: durationMinutesSchema,
  templateIds: templateIdsSchema,
  rescheduleCutoffHours: rescheduleCutoffHoursSchema,
});

/** A new medical service, shared by the form and the services: it starts sending no template. */
export const medicalServiceInputSchema = medicalServiceFields.extend({
  practitionerId: z.uuid(),
  templateIds: templateIdsSchema.default([]),
  rescheduleCutoffHours: rescheduleCutoffHoursSchema.default(24),
});

export const medicalServiceUpdateSchema = medicalServiceFields.extend({
  medicalServiceId: z.uuid(),
});

export const medicalServiceActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type MedicalServiceFields = z.input<typeof medicalServiceFields>;
export type MedicalServiceInput = z.input<typeof medicalServiceInputSchema>;
export type MedicalServiceUpdate = z.input<typeof medicalServiceUpdateSchema>;
export type MedicalServiceActiveChange = z.input<typeof medicalServiceActiveChangeSchema>;
