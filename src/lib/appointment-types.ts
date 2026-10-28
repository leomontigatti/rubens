import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/**
 * The colour keys a type can take. They stand in for the brand palette until
 * it lands (#37): each draws from one of the theme's chart tokens.
 */
export const appointmentTypeColors = ["color1", "color2", "color3", "color4", "color5"] as const;

export type AppointmentTypeColor = (typeof appointmentTypeColors)[number];

/** The swatch class of each colour key. */
export const appointmentTypeColorClasses: Record<AppointmentTypeColor, string> = {
  color1: "bg-chart-1",
  color2: "bg-chart-2",
  color3: "bg-chart-3",
  color4: "bg-chart-4",
  color5: "bg-chart-5",
};

export const appointmentTypeColorLabels: Record<AppointmentTypeColor, string> = {
  color1: "Color 1",
  color2: "Color 2",
  color3: "Color 3",
  color4: "Color 4",
  color5: "Color 5",
};

const appointmentTypeFields = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: durationMinutesSchema,
  color: z.enum(appointmentTypeColors),
});

/** A new appointment type, shared by the form and the services. */
export const appointmentTypeInputSchema = appointmentTypeFields.extend({
  practitionerId: z.uuid(),
});

export const appointmentTypeUpdateSchema = appointmentTypeFields.extend({
  appointmentTypeId: z.uuid(),
});

export const appointmentTypeActiveChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type AppointmentTypeFields = z.input<typeof appointmentTypeFields>;
export type AppointmentTypeInput = z.input<typeof appointmentTypeInputSchema>;
export type AppointmentTypeUpdate = z.input<typeof appointmentTypeUpdateSchema>;
export type AppointmentTypeActiveChange = z.input<typeof appointmentTypeActiveChangeSchema>;
