import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, eq, inArray } from "drizzle-orm";

import {
  appointment,
  medicalService,
  member,
  office,
  patient,
  practitioner,
  room,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { decideUndo, statusActionsFor } from "#/lib/appointment-statuses.ts";
import type { StatusAction, StatusActor } from "#/lib/appointment-statuses.ts";
import { activeAppointmentStatuses, bookingInputSchema } from "#/lib/appointments.ts";
import type { AppointmentStatus, BookingInput, WarningConfirmation } from "#/lib/appointments.ts";
import type { FreeStart } from "#/lib/availability.ts";
import { cellMinutes } from "#/lib/calendar-layout.ts";
import { patientName } from "#/lib/patients.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { placeNew } from "#/server/appointment-placement.ts";
import type { PlacementRefusal } from "#/server/appointment-placement.ts";
import { findFreeTimes } from "#/server/availability.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Appointments (ui: "Turno"). Reception and admins book for any practitioner,
// a practitioner for themselves. A booking is taken only at a free time, in
// the room of the schedule it falls in, never over another practitioner's
// appointment there. Two bookings racing for one time are settled by the
// exclusion constraints `appointment_practitioner_overlap` and
// `appointment_room_overlap` (migration 0013): the loser gets "timeTaken"
// with fresh free times. The placement module (`appointment-placement.ts`) does
// all of that, and writes every booking to the audit log, about its patient.
// `database` is for tests, which pass a transaction running as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

export type BookingResult =
  | { ok: true; appointment: { id: string } }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" | "practitionerInactive" }
  | PlacementRefusal<"freeStart">;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** Whether the actor may book at all, before any row is read. */
export function booksForSome(actor: Actor): boolean {
  return actsForEveryone(actor) || actor.roles.includes("practitioner");
}

/** The practitioner, when the actor may book for them and they are active. */
export async function findBookablePractitioner(
  tx: Transaction,
  actor: Actor,
  practitionerId: string,
) {
  const found = await findPractitioner(tx, actor, practitionerId, false);
  if (!found) {
    return notFound;
  }
  if (!actsForEveryone(actor) && !found.canEdit) {
    return forbidden;
  }
  if (!found.active) {
    return { ok: false as const, reason: "practitionerInactive" as const };
  }
  return { ok: true as const, ...found };
}

/**
 * Books the patient at a free start of the practitioner's, for the duration.
 * The patient's other appointments that day warn until `confirmWarnings`.
 */
export async function bookAppointment(
  actor: Actor,
  input: BookingInput & WarningConfirmation,
  database?: AnyDatabase,
): Promise<BookingResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { practitionerId, start, durationMinutes, ...visit } = parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const placed = await placeNew(
        tx,
        actor,
        found,
        visit,
        { kind: "freeStart", span },
        { confirmWarnings: input.confirmWarnings === true },
      );
      return placed.ok ? { ok: true as const, appointment: { id: placed.id } } : placed;
    },
    database,
  );
}

/** An appointment as the calendar draws it. */
export interface DayAppointment {
  id: string;
  practitionerId: string;
  practitionerName: string;
  patientId: string;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  /** The status changes the viewer may make now. */
  actions: StatusAction[];
  /** The status an undo would go back to, when the viewer may undo now. */
  undoStatus: AppointmentStatus | null;
  cancelledBy: "patient" | "business" | null;
  cancellationReason: string | null;
  overbooking: boolean;
  patientName: string;
  medicalServiceName: string;
  /** Its practitioner's colour. */
  color: PractitionerColor;
  roomId: string;
  roomName: string;
  /** The office of the room, whose rooms a move can pick from. */
  officeId: string;
  receptionNote: string | null;
}

/** The status an undo would restore, when the viewer may undo now. */
function undoStatusOf(
  booked: {
    status: AppointmentStatus;
    previousStatus: AppointmentStatus | null;
    statusChangedAt: Date;
  },
  timeZone: string,
  viewer: StatusActor,
  now: Date,
): AppointmentStatus | null {
  const decided = decideUndo({ ...booked, timeZone }, viewer, now);
  return decided.ok ? decided.status : null;
}

const dayAppointmentColumns = {
  id: appointment.id,
  patientId: appointment.patientId,
  practitionerId: appointment.practitionerId,
  practitionerName: practitioner.displayName,
  practitionerUserId: member.userId,
  during: appointment.during,
  status: appointment.status,
  previousStatus: appointment.previousStatus,
  statusChangedAt: appointment.statusChangedAt,
  cancelledBy: appointment.cancelledBy,
  cancellationReason: appointment.cancellationReason,
  overbooking: appointment.overbooking,
  firstName: patient.firstName,
  lastName: patient.lastName,
  chosenName: patient.chosenName,
  medicalServiceName: medicalService.name,
  color: practitioner.color,
  roomId: appointment.roomId,
  roomName: room.name,
  officeId: office.id,
  timeZone: office.timeZone,
  receptionNote: appointment.receptionNote,
};

/**
 * The calendar's reading of appointments, joined to their practitioner and
 * the practitioner's member, room, office, patient and medical service.
 */
export function selectDayAppointments(tx: Transaction, actor: Actor) {
  return tx
    .select(dayAppointmentColumns)
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(
      member,
      and(eq(member.id, practitioner.memberId), eq(member.organizationId, actor.organizationId)),
    )
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId));
}

type DayAppointmentRow = Awaited<ReturnType<typeof selectDayAppointments>>[number];

/** An appointment as the calendar draws it, with what `viewer` may do to it at `now`. */
export function toDayAppointment(
  booked: DayAppointmentRow,
  viewer: StatusActor,
  now: Date,
): DayAppointment {
  return {
    id: booked.id,
    practitionerId: booked.practitionerId,
    practitionerName: booked.practitionerName,
    patientId: booked.patientId,
    start: booked.during.start,
    end: booked.during.end,
    status: booked.status,
    actions: statusActionsFor({ status: booked.status, start: booked.during.start }, viewer, now),
    undoStatus: undoStatusOf(booked, booked.timeZone, viewer, now),
    cancelledBy: booked.cancelledBy,
    cancellationReason: booked.cancellationReason,
    overbooking: booked.overbooking,
    patientName: patientName(booked),
    medicalServiceName: booked.medicalServiceName,
    color: booked.color,
    roomId: booked.roomId,
    roomName: booked.roomName,
    officeId: booked.officeId,
    receptionNote: booked.receptionNote,
  };
}

/**
 * The practitioner's free calendar cells inside `window`, in the room: starts
 * on the cells' grid from local midnight that are also free starts on the
 * practitioner's own grid, for a cell or for `durationMinutes` when given.
 */
export async function findFreeCells(
  tx: Transaction,
  practitioner: { id: string; gridMinutes: number },
  options: { window: TimeRange; officeId: string; roomId: string; durationMinutes?: number },
) {
  const { window, officeId, roomId, durationMinutes = cellMinutes } = options;
  const { free, schedules } = await findFreeTimes(tx, practitioner, {
    window,
    officeId,
    durationMinutes,
  });
  const zones = new Map(schedules.map((where) => [where.roomId, where.timeZone]));
  const onCellGrid = (slot: FreeStart) =>
    Number(format(slot.start, "m", { in: tz(zones.get(slot.roomId)!) })) % cellMinutes === 0;
  return free.filter((slot) => slot.roomId === roomId && onCellGrid(slot));
}

/**
 * The calendar leaves out cancelled and no-show appointments unless asked
 * for: their time is free again.
 */
export function shownOnCalendar(includeCancelledAndNoShow: boolean) {
  return includeCancelledAndNoShow
    ? undefined
    : inArray(appointment.status, [...activeAppointmentStatuses]);
}
