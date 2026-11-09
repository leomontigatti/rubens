import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/** The longest time a medical service's messages are set before or after an appointment: 30 days. */
export const maxMessageHours = 720;

/** The most reminders a medical service sends for one appointment. */
export const maxReminders = 5;

const hoursSchema = (min: number) => z.int().min(min).max(maxMessageHours);

/** A reminder (`docs/domain/messages.md`): hours before the appointment, and whether it asks to confirm. */
const reminderSchema = z.object({
  hoursBefore: hoursSchema(1),
  asksToConfirm: z.boolean(),
});

export type Reminder = z.output<typeof reminderSchema>;

const remindersSchema = z
  .array(reminderSchema)
  .max(maxReminders)
  .refine(
    (reminders) => new Set(reminders.map((one) => one.hoursBefore)).size === reminders.length,
    "Two reminders at the same time",
  )
  // Saved latest first.
  .transform((reminders) => [...reminders].sort((a, b) => b.hoursBefore - a.hoursBefore));

/** Sent once an appointment is attended; blank means none. The object checks its length against the template. */
const careInstructionsSchema = z
  .string()
  // Generous over the template's room, so the object's check names the length.
  .max(4096)
  .trim()
  .nullable()
  .transform((text) => text || null);

/** Hours after the appointment the follow-up goes, or `null` for none. */
const followUpHoursSchema = hoursSchema(1).nullable();

/** Until how many hours before the appointment the patient can move it through the assistant. */
const rescheduleCutoffHoursSchema = hoursSchema(0);

const medicalServiceFields = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: durationMinutesSchema,
  /** Whether its appointments' patients get the booking confirmation. */
  bookingConfirmation: z.boolean().default(true),
  reminders: remindersSchema,
  careInstructions: careInstructionsSchema,
  followUpHours: followUpHoursSchema,
  rescheduleCutoffHours: rescheduleCutoffHoursSchema,
});

/** A new medical service, shared by the form and the services: its patient messages start unset. */
export const medicalServiceInputSchema = medicalServiceFields.extend({
  practitionerId: z.uuid(),
  reminders: remindersSchema.default([]),
  careInstructions: careInstructionsSchema.default(null),
  followUpHours: followUpHoursSchema.default(null),
  rescheduleCutoffHours: rescheduleCutoffHoursSchema.default(24),
});

// An edit names every patient message, so a form from before they existed is
// refused instead of clearing them.
export const medicalServiceUpdateSchema = medicalServiceFields.extend({
  medicalServiceId: z.uuid(),
});

export const medicalServiceActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type MedicalServiceFields = z.input<typeof medicalServiceFields>;
export type MedicalServiceInput = z.input<typeof medicalServiceInputSchema>;
export type MedicalServiceUpdate = z.input<typeof medicalServiceUpdateSchema>;
export type MedicalServiceActiveChange = z.input<typeof medicalServiceActiveChangeSchema>;
