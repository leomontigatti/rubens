import * as z from "zod";

import { durationMinutesSchema } from "#/lib/availability.ts";

/** Where an appointment stands (docs/domain/appointments.md § Statuses). */
export const appointmentStatuses = [
  "booked",
  "confirmed",
  "checkedIn",
  "attended",
  "noShow",
  "cancelled",
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

/**
 * The statuses that hold the practitioner's time: the exclusion constraint
 * (migration 0013) and the free times count them.
 */
export const activeAppointmentStatuses = [
  "booked",
  "confirmed",
  "checkedIn",
  "attended",
] as const satisfies readonly AppointmentStatus[];

/** Who cancelled an appointment. */
export const appointmentCancellers = ["patient", "business"] as const;

/** The longest reception note: a practical line, never clinical text. */
export const receptionNoteMaxLength = 200;

/** A booking at a free time, shared by the form and the service. */
export const bookingInputSchema = z.object({
  patientId: z.uuid(),
  practitionerId: z.uuid(),
  appointmentTypeId: z.uuid(),
  start: z.coerce.date(),
  durationMinutes: durationMinutesSchema,
  receptionNote: z
    .string()
    .trim()
    .max(receptionNoteMaxLength)
    .transform((note) => note || null)
    .nullable()
    .default(null),
});

export type BookingInput = z.input<typeof bookingInputSchema>;

/**
 * A sobreturno: a booking at any start, over another appointment or outside
 * the schedules. Outside them it needs a room; inside one, `null` keeps the
 * schedule's room.
 */
export const overbookingInputSchema = bookingInputSchema.extend({
  roomId: z.uuid().nullable().default(null),
});

export type OverbookingInput = z.input<typeof overbookingInputSchema>;

/** Moving an appointment to another room of its office, at the same time. */
export const roomMoveSchema = z.object({ appointmentId: z.uuid(), roomId: z.uuid() });

export type RoomMove = z.input<typeof roomMoveSchema>;

/** Sent with a booking to save it although the patient warning was shown. */
export interface WarningConfirmation {
  confirmWarnings?: boolean;
}

/** The office and the local date the day view shows. */
export const officeDayQuerySchema = z.object({ officeId: z.uuid(), date: z.iso.date() });

export type OfficeDayQuery = z.input<typeof officeDayQuerySchema>;

/** What the day view's URL asks for, each value already parsed. */
export interface AgendaSearch {
  sede?: string;
  fecha?: string;
}

/** The office and date the day view shows, with their defaults: the first office, today. */
export function agendaViewOf(
  search: AgendaSearch,
  offices: readonly { id: string }[],
  today: string,
): { officeId: string | null; date: string } {
  return { officeId: search.sede ?? offices[0]?.id ?? null, date: search.fecha ?? today };
}
