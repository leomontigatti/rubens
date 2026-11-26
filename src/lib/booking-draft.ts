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
import { formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";

// The booking form's values, from either entry (docs/domain/appointments.md §
// Booking), and what they book.

export interface PickedStart {
  start: Date;
  roomName: string;
}

export interface OfferedStart extends PickedStart {
  officeName: string;
}

export interface BookingWarning {
  kind: "overlap" | "sameDay";
  start: Date;
  end: Date;
  practitionerName: string;
}

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

export function initialBookingValues(
  from: BookingStart | null,
  practitionerIds: readonly string[],
  defaultDate: string,
): BookingValues {
  const medicalService = from?.medicalService ?? null;
  const date = from ? format(from.start, "yyyy-MM-dd", { in: tz(practiceTimeZone) }) : defaultDate;
  const time = from ? formatTime(from.start, practiceTimeZone) : "";
  return {
    patient: null,
    practitionerId: practitionerIds.length === 1 ? (practitionerIds[0] ?? "") : "",
    medicalServiceId: medicalService?.id ?? "",
    durationMinutes: medicalService ? String(medicalService.durationMinutes) : "",
    start: from && { start: from.start, roomName: from.roomName },
    freeFrom: defaultDate,
    date,
    time,
    roomId: "",
    receptionNote: "",
  };
}

function partialInputOf(values: BookingValues) {
  return {
    patientId: values.patient?.id,
    practitionerId: values.practitionerId,
    medicalServiceId: values.medicalServiceId,
    durationMinutes: Number(values.durationMinutes),
    receptionNote: values.receptionNote,
  };
}

export function bookingRequestOf(values: BookingValues) {
  return bookingInputSchema.safeParse({ ...partialInputOf(values), start: values.start?.start });
}

export function overbookingRequestOf(values: BookingValues) {
  return overbookingInputSchema.safeParse({
    ...partialInputOf(values),
    start:
      isWholeDate(values.date) && isWholeTime(values.time)
        ? instantOf(values.date, values.time, practiceTimeZone)
        : undefined,
    roomId: values.roomId || null,
  });
}

export const bookingFieldNames = { patientId: "patient" };

export const overbookingFieldNames = { patientId: "patient", start: "time" };

function isWholeDate(date: string): boolean {
  return z.iso.date().safeParse(date).success;
}

function isWholeTime(time: string): boolean {
  return z.iso.time({ precision: -1 }).safeParse(time).success;
}

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

export interface RescheduleValues {
  durationMinutes: string;
  freeFrom: string;
  start: PickedStart | null;
}

export function rescheduleRequestOf(values: RescheduleValues, appointmentId: string) {
  return rescheduleSchema.safeParse({
    appointmentId,
    start: values.start?.start,
    durationMinutes: Number(values.durationMinutes),
  });
}

const offeredStartsReadFor = new Set<keyof BookingValues>([
  "practitionerId",
  "medicalServiceId",
  "durationMinutes",
  "freeFrom",
]);

/**
 * Whether the free times offered after the picked start stopped being free
 * still hold once `changedField` changes: they do unless it is one they were read for.
 */
export function keepsOfferedStarts(changedField: string): boolean {
  return !offeredStartsReadFor.has(changedField as keyof BookingValues);
}

export function showsWeekOfStarts(form: {
  fixed: boolean;
  start: PickedStart | null;
  offeredStarts: readonly OfferedStart[] | null;
}): boolean {
  if (!form.fixed) {
    return true;
  }
  return form.start === null && !form.offeredStarts?.length;
}
