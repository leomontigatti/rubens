import { bookingInputSchema, overbookingInputSchema } from "#/lib/appointments.ts";
import { durationMinutesSchema } from "#/lib/availability.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";

// The booking form's state, from either entry (docs/domain/appointments.md §
// Booking): what is picked so far, and what the last attempt answered. Pure,
// so the form only renders it.

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

export interface BookingDraft {
  patientId: string | null;
  practitionerId: string;
  type: { id: string; durationMinutes: number } | null;
  durationMinutes: number | null;
  start: PickedStart | null;
  receptionNote: string;
  /** The patient warning the last attempt returned, until the time or patient changes. */
  warnings: BookingWarning[] | null;
  /** Fresh free starts after another booking took the time. */
  freshStarts: OfferedStart[] | null;
  error: string | null;
}

export type BookingEvent =
  | { type: "patientPicked"; patientId: string | null }
  | { type: "practitionerChosen"; practitionerId: string }
  | {
      type: "typeChosen";
      medicalService: { id: string; durationMinutes: number } | null | undefined;
    }
  | { type: "durationChanged"; durationMinutes: number }
  | { type: "startPicked"; start: PickedStart | null }
  | { type: "noteChanged"; receptionNote: string }
  | { type: "warned"; warnings: BookingWarning[] }
  | { type: "timeTaken"; freshStarts: OfferedStart[] }
  | { type: "failed"; error: string };

/**
 * A new draft: from a clicked free time the practitioner and the start are
 * set; from "Nuevo turno", the only practitioner when there is one.
 */
export function initialBookingDraft(
  slot: (PickedStart & { practitionerId: string }) | null,
  practitionerIds: readonly string[],
): BookingDraft {
  const onlyOne = practitionerIds.length === 1 ? practitionerIds[0]! : "";
  return {
    patientId: null,
    practitionerId: slot?.practitionerId ?? onlyOne,
    type: null,
    durationMinutes: null,
    start: slot,
    receptionNote: "",
    warnings: null,
    freshStarts: null,
    error: null,
  };
}

const answered = { warnings: null, freshStarts: null, error: null };

export function bookingReducer(draft: BookingDraft, event: BookingEvent): BookingDraft {
  switch (event.type) {
    case "patientPicked":
      return { ...draft, ...answered, patientId: event.patientId };
    case "practitionerChosen":
      // A type and a start belong to one practitioner.
      return {
        ...draft,
        ...answered,
        practitionerId: event.practitionerId,
        type: null,
        durationMinutes: null,
        start: null,
      };
    case "typeChosen":
      return {
        ...draft,
        ...answered,
        type: event.medicalService ?? null,
        durationMinutes: event.medicalService?.durationMinutes ?? null,
      };
    case "durationChanged":
      return { ...draft, ...answered, durationMinutes: event.durationMinutes };
    case "startPicked":
      return { ...draft, ...answered, start: event.start };
    case "noteChanged":
      return { ...draft, receptionNote: event.receptionNote };
    case "warned":
      return { ...draft, ...answered, warnings: event.warnings };
    case "timeTaken":
      return { ...draft, ...answered, start: null, freshStarts: event.freshStarts };
    case "failed":
      return { ...draft, ...answered, error: event.error };
  }
}

/** What the draft books but the start and the room, as the booking schemas read it. */
function partialInputOf(draft: BookingDraft) {
  return {
    patientId: draft.patientId,
    practitionerId: draft.practitionerId,
    medicalServiceId: draft.type?.id,
    durationMinutes: draft.durationMinutes,
    receptionNote: draft.receptionNote,
  };
}

/** What the draft books, once the booking schema accepts it. */
export function bookingRequestOf(draft: BookingDraft) {
  const parsed = bookingInputSchema.safeParse({
    ...partialInputOf(draft),
    start: draft.start?.start,
  });
  return parsed.success ? parsed.data : null;
}

/** Where and when an overbooking is typed in: a local date and `HH:MM`, and a room or none. */
export interface OverbookingPlace {
  date: string;
  time: string;
  /** Empty for the room of the schedule the overbooking falls in. */
  roomId: string;
}

/** What an overbooking draft books, its local date and time read in `timeZone`. */
export function overbookingRequestOf(
  draft: BookingDraft,
  place: OverbookingPlace,
  timeZone: string,
) {
  const parsed = overbookingInputSchema.safeParse({
    ...partialInputOf(draft),
    start: instantOf(place.date, place.time, timeZone),
    roomId: place.roomId || null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * "Nuevo turno"'s free-times query: the week from `firstDate`, once the draft
 * has a practitioner, a type and a valid duration.
 */
export function freeStartsQueryOf(
  draft: BookingDraft,
  firstDate: string,
): AvailabilityQuery | null {
  const duration = durationMinutesSchema.safeParse(draft.durationMinutes);
  if (!draft.practitionerId || !draft.type || !duration.success) {
    return null;
  }
  return {
    practitionerId: draft.practitionerId,
    firstDate,
    lastDate: shiftDate(firstDate, 6),
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
  if (!duration.success) {
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
