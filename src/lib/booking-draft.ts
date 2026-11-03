import { tz } from "@date-fns/tz";
import * as z from "zod";
import { format } from "date-fns";

import {
  bookingInputSchema,
  overbookingInputSchema,
  rescheduleSchema,
} from "#/lib/appointments.ts";
import { durationMinutesSchema } from "#/lib/availability.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";

// The booking form's values, from either entry (docs/domain/appointments.md §
// Booking), and what they book: pure, so the form only renders them.

/** A start picked for the booking, with where it is and how to show it. */
export interface PickedStart {
  start: Date;
  roomName: string;
  timeZone: string;
}

/** A free start offered to pick from, with its office. */
export interface OfferedStart extends PickedStart {
  officeName: string;
}

export interface BookingWarning {
  kind: "overlap" | "sameDay";
  start: Date;
  end: Date;
  practitionerName: string;
  timeZone: string;
}

/** The patient picked, with the name the form shows. */
export interface PickedPatient {
  id: string;
  name: string;
}

/**
 * The booking form's values. A booking picks a free `start`, from the week
 * from `freeFrom` unless a clicked cell fixed it; an overbooking types its
 * local `date` and `time`, and a room or none. Numbers hold their text, as typed.
 */
export interface BookingValues {
  patient: PickedPatient | null;
  practitionerId: string;
  medicalServiceId: string;
  durationMinutes: string;
  start: PickedStart | null;
  freeFrom: string;
  date: string;
  time: string;
  /** Empty for the room of the schedule the overbooking falls in. */
  roomId: string;
  receptionNote: string;
}

/** Where a booking starts from: a clicked free cell, or an appointment an overbooking goes over. */
export interface BookingStart extends PickedStart {
  /** The medical service the calendar is narrowed to. */
  medicalService?: { id: string; durationMinutes: number } | null;
}

/**
 * A new form, among `practitionerIds`, the only one when there is one. From a
 * clicked free cell, its start and the medical service the calendar is
 * narrowed to; for an overbooking, the start's local date and time.
 */
export function initialBookingValues(
  from: BookingStart | null,
  practitionerIds: readonly string[],
  defaultDate: string,
): BookingValues {
  const medicalService = from?.medicalService ?? null;
  const [date, time] = from
    ? format(from.start, "yyyy-MM-dd HH:mm", { in: tz(from.timeZone) }).split(" ")
    : [defaultDate, ""];
  return {
    patient: null,
    practitionerId: practitionerIds.length === 1 ? practitionerIds[0]! : "",
    medicalServiceId: medicalService?.id ?? "",
    durationMinutes: medicalService ? String(medicalService.durationMinutes) : "",
    start: from && { start: from.start, roomName: from.roomName, timeZone: from.timeZone },
    freeFrom: defaultDate,
    date: date!,
    time: time!,
    roomId: "",
    receptionNote: "",
  };
}

/** What the form books but the start and the room, as the booking schemas read it. */
function partialInputOf(values: BookingValues) {
  return {
    patientId: values.patient?.id,
    practitionerId: values.practitionerId,
    medicalServiceId: values.medicalServiceId,
    durationMinutes: Number(values.durationMinutes),
    receptionNote: values.receptionNote,
  };
}

/** What the form books at a free start, or what the booking schema refused. */
export function bookingRequestOf(values: BookingValues) {
  return bookingInputSchema.safeParse({ ...partialInputOf(values), start: values.start?.start });
}

/** What an overbooking books, its local date and time read in `timeZone`, or what was refused. */
export function overbookingRequestOf(values: BookingValues, timeZone: string) {
  return overbookingInputSchema.safeParse({
    ...partialInputOf(values),
    start: values.date && values.time ? instantOf(values.date, values.time, timeZone) : undefined,
    roomId: values.roomId || null,
  });
}

/** The form's field for each input the booking schemas name otherwise. */
export const bookingFieldNames = { patientId: "patient" };

/** An overbooking's start is typed in its time. */
export const overbookingFieldNames = { patientId: "patient", start: "time" };

/** A date input's value once it is a whole date: cleared, or half typed, it is none. */
function isWholeDate(date: string): boolean {
  return z.iso.date().safeParse(date).success;
}

/**
 * "Nuevo turno"'s free-times query: the week from `freeFrom`, once the form
 * has a practitioner, a medical service and a valid duration.
 */
export function freeStartsQueryOf(values: BookingValues): AvailabilityQuery | null {
  const duration = durationMinutesSchema.safeParse(Number(values.durationMinutes));
  const ready = values.practitionerId && values.medicalServiceId && isWholeDate(values.freeFrom);
  if (!ready || !duration.success) {
    return null;
  }
  return {
    practitionerId: values.practitionerId,
    firstDate: values.freeFrom,
    lastDate: shiftDate(values.freeFrom, 6),
    durationMinutes: duration.data,
  };
}

/**
 * Rescheduling's free starts for the practitioner and duration, a week from a
 * date, with the appointment's own time counted free; `null` while the
 * duration is not a valid one.
 */
export function rescheduleQueryOf(
  appointment: { id: string; practitionerId: string },
  firstDate: string,
  durationMinutes: number,
): AvailabilityQuery | null {
  const duration = durationMinutesSchema.safeParse(durationMinutes);
  if (!duration.success || !isWholeDate(firstDate)) {
    return null;
  }
  return {
    practitionerId: appointment.practitionerId,
    firstDate,
    lastDate: shiftDate(firstDate, 6),
    durationMinutes: duration.data,
    appointmentId: appointment.id,
  };
}

/** The reschedule form's values: the duration as typed, and a free start from the week from `freeFrom`. */
export interface RescheduleValues {
  durationMinutes: string;
  freeFrom: string;
  start: PickedStart | null;
}

/** Where the reschedule form moves the appointment, or what the reschedule schema refused. */
export function rescheduleRequestOf(values: RescheduleValues, appointmentId: string) {
  return rescheduleSchema.safeParse({
    appointmentId,
    start: values.start?.start,
    durationMinutes: Number(values.durationMinutes),
  });
}
