import * as z from "zod";

import { documentFields, normalizeDocument, phoneSchema } from "#/lib/patients.ts";

const guardianFields = z.object({
  name: z.string().trim().min(1).max(200),
  relationship: z.string().trim().min(1).max(100),
  ...documentFields,
  phone: phoneSchema,
  email: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
});

/**
 * A guardian's fields (ui: "Responsable"), shared by the form and the
 * services. The phone is read as a patient's is; the document is optional.
 */
export const guardianInputSchema = guardianFields
  .extend({ patientId: z.uuid() })
  .transform(normalizeDocument);

export const guardianUpdateSchema = guardianFields
  .extend({ guardianId: z.uuid() })
  .transform(normalizeDocument);

export const guardianIdSchema = z.object({ guardianId: z.uuid() });

/** Who messages go to: one of the patient's guardians, or the patient when `null`. */
export const messageContactChangeSchema = z.object({
  patientId: z.uuid(),
  guardianId: z.uuid().nullable(),
});

export type GuardianInput = z.input<typeof guardianInputSchema>;
export type GuardianUpdate = z.input<typeof guardianUpdateSchema>;
export type GuardianId = z.input<typeof guardianIdSchema>;
export type MessageContactChange = z.input<typeof messageContactChangeSchema>;
