import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/** The longest reschedule cutoff: 30 days. */
const maxCutoffHours = 720;

/**
 * The organization's templates its appointments get (docs/domain/messages.md
 * § The organization's templates), each once.
 */
const templateIdsSchema = z
  .array(z.uuid())
  .max(50)
  .transform((ids) => [...new Set(ids)]);

/** Until how many hours before the appointment the patient can move it through the assistant. */
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

// An edit names every template it sends, so a form from before they existed is
// refused instead of clearing them.
export const medicalServiceUpdateSchema = medicalServiceFields.extend({
  medicalServiceId: z.uuid(),
});

export const medicalServiceActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type MedicalServiceFields = z.input<typeof medicalServiceFields>;
export type MedicalServiceInput = z.input<typeof medicalServiceInputSchema>;
export type MedicalServiceUpdate = z.input<typeof medicalServiceUpdateSchema>;
export type MedicalServiceActiveChange = z.input<typeof medicalServiceActiveChangeSchema>;
