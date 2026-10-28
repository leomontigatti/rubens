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

/** A reception note: blank is none. */
const receptionNoteSchema = z
  .string()
  .trim()
  .max(receptionNoteMaxLength)
  .transform((note) => note || null)
  .nullable()
  .default(null);

/** A booking at a free time, shared by the form and the service. */
export const bookingInputSchema = z.object({
  patientId: z.uuid(),
  practitionerId: z.uuid(),
  medicalServiceId: z.uuid(),
  start: z.coerce.date(),
  durationMinutes: durationMinutesSchema,
  receptionNote: receptionNoteSchema,
});

export type BookingInput = z.input<typeof bookingInputSchema>;

/**
 * An overbooking: a booking at any start, over another appointment or outside
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
export const officeDayQuerySchema = z.object({
  officeId: z.uuid(),
  date: z.iso.date(),
  /** Cancelled and no-show appointments are hidden unless asked for. */
  includeCancelledAndNoShow: z.boolean().default(false),
});

export type OfficeDayQuery = z.input<typeof officeDayQuerySchema>;

/**
 * The practitioner and the first local date, in the organization's default
 * zone, of the seven days the week view shows.
 */
export const practitionerWeekQuerySchema = z.object({
  practitionerId: z.uuid(),
  date: z.iso.date(),
  /** Cancelled and no-show appointments are hidden unless asked for. */
  includeCancelledAndNoShow: z.boolean().default(false),
});

export type PractitionerWeekQuery = z.input<typeof practitionerWeekQuerySchema>;

/** The office and the local date the room view shows. */
export const roomDayQuerySchema = officeDayQuerySchema.pick({ officeId: true, date: true });

export type RoomDayQuery = z.input<typeof roomDayQuerySchema>;

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

/** What the week view's URL asks for, each value already parsed. */
export interface WeekSearch {
  profesional?: string;
  fecha?: string;
  cancelados?: boolean;
}

/**
 * The practitioner and first date the week view shows, with their defaults:
 * the first practitioner, today, cancelled and no-show appointments hidden.
 */
export function weekViewOf(
  search: WeekSearch,
  practitioners: readonly { id: string }[],
  today: string,
): { practitionerId: string | null; date: string; includeCancelledAndNoShow: boolean } {
  return {
    practitionerId: search.profesional ?? practitioners[0]?.id ?? null,
    date: search.fecha ?? today,
    includeCancelledAndNoShow: search.cancelados === true,
  };
}

/** The status changes made by a button: every one but cancelling, which says who cancelled. */
export const statusChangeSchema = z.object({
  appointmentId: z.uuid(),
  status: z.enum(["confirmed", "checkedIn", "attended", "noShow"]),
});

export type StatusChangeInput = z.input<typeof statusChangeSchema>;

/** The longest cancellation reason. */
export const cancellationReasonMaxLength = 200;

/** Cancelling: who cancelled, the patient or the business, and an optional reason. */
export const cancellationSchema = z.object({
  appointmentId: z.uuid(),
  cancelledBy: z.enum(appointmentCancellers),
  reason: z
    .string()
    .trim()
    .max(cancellationReasonMaxLength)
    .transform((reason) => reason || null)
    .nullable()
    .default(null),
});

export type CancellationInput = z.input<typeof cancellationSchema>;

/** A new reception note for an appointment. */
export const receptionNoteChangeSchema = z.object({
  appointmentId: z.uuid(),
  receptionNote: receptionNoteSchema,
});

export type ReceptionNoteChange = z.input<typeof receptionNoteChangeSchema>;

/** One appointment, named by its id. */
export const appointmentIdSchema = z.object({ appointmentId: z.uuid() });

export type AppointmentIdInput = z.input<typeof appointmentIdSchema>;

/**
 * Moving an appointment to a new time, and so maybe a new room or office: at
 * a free start, which takes its schedule's room, or as an overbooking, placed
 * as booking one is.
 */
export const rescheduleSchema = z.object({
  appointmentId: z.uuid(),
  start: z.coerce.date(),
  durationMinutes: durationMinutesSchema,
  overbooking: z.boolean().default(false),
  roomId: z.uuid().nullable().default(null),
});

export type RescheduleInput = z.input<typeof rescheduleSchema>;
