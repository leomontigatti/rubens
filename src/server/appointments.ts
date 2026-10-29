import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

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
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { recordAudit } from "#/server/audit.ts";
import { findFreeTimes, meets, toAvailableStarts } from "#/server/availability.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Appointments (ui: "Turno"). Reception and admins book for any practitioner,
// a practitioner for themselves. A booking is taken only at a free time, in
// the room of the schedule it falls in, never over another practitioner's
// appointment there. Two bookings racing for one time are settled by the
// exclusion constraints `appointment_practitioner_overlap` and
// `appointment_room_overlap` (migration 0013): the loser gets "timeTaken"
// with fresh free times. Every
// booking is written to the audit log, about its patient. `database` is for
// tests, which pass a transaction running as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

type Refusal =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "practitionerInactive"
  | "patientInactive"
  | "medicalServiceInactive"
  | "notFree";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

/** Another appointment of the patient's that a booking warns about. */
export interface PatientWarning {
  kind: "overlap" | "sameDay";
  start: Date;
  end: Date;
  practitionerName: string;
  /** The zone of the appointment's office, to show it in local time. */
  timeZone: string;
}

export type BookingResult =
  | Result<{ appointment: { id: string } }>
  | { ok: false; reason: "patientWarning"; warnings: PatientWarning[] }
  | { ok: false; reason: "timeTaken"; freeStarts: AvailableStart[] };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

const overlapConstraints = ["appointment_practitioner_overlap", "appointment_room_overlap"];

/** Whether the actor may book at all, before any row is read. */
export function booksForSome(actor: Actor): boolean {
  return actsForEveryone(actor) || actor.roles.includes("practitioner");
}

/** Whether `error`, or an error it wraps, is a violation of the constraint `name`. */
function violates(error: unknown, name: string): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ("constraint" in cause && cause.constraint === name) {
      return true;
    }
  }
  return false;
}

/**
 * Inserts an appointment in a savepoint, so a booking that lost the race to
 * another keeps its transaction and can read fresh free times.
 */
export async function insertAppointment(
  tx: Transaction,
  values: typeof appointment.$inferInsert,
): Promise<{ ok: true; id: string } | { ok: false; reason: "timeTaken" }> {
  try {
    const [created] = await tx.transaction((savepoint) =>
      savepoint.insert(appointment).values(values).returning({ id: appointment.id }),
    );
    return { ok: true, id: created!.id };
  } catch (error) {
    if (overlapConstraints.some((name) => violates(error, name))) {
      return { ok: false, reason: "timeTaken" };
    }
    throw error;
  }
}

/**
 * Locks the appointment row for the rest of the transaction, so changes of one
 * appointment run one after the other. Taken before any room lock.
 */
export async function lockAppointment(tx: Transaction, appointmentId: string): Promise<void> {
  await tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(eq(appointment.id, appointmentId))
    .for("update");
}

/**
 * Updates an appointment in a savepoint, as `insertAppointment` inserts one:
 * a change that would make it overlap another active one is "timeTaken".
 */
export async function updateAppointment(
  tx: Transaction,
  appointmentId: string,
  values: Partial<typeof appointment.$inferInsert>,
): Promise<{ ok: true } | { ok: false; reason: "timeTaken" }> {
  try {
    await tx.transaction((savepoint) =>
      savepoint
        .update(appointment)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(appointment.id, appointmentId)),
    );
    return { ok: true };
  } catch (error) {
    if (overlapConstraints.some((name) => violates(error, name))) {
      return { ok: false, reason: "timeTaken" };
    }
    throw error;
  }
}

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
}

export function localDay(instant: Date, timeZone: string): TimeRange {
  const date = localDate(instant, timeZone);
  return toTimeRange({ kind: "days", firstDate: date, lastDate: date }, timeZone);
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The patient's active appointments on the local day of `span`, as warnings,
 * but for `excludeId`, the one being rescheduled.
 */
export async function findPatientWarnings(
  tx: Transaction,
  patientId: string,
  span: TimeRange,
  timeZone: string,
  excludeId?: string,
): Promise<PatientWarning[]> {
  const rows = await tx
    .select({
      during: appointment.during,
      practitionerName: practitioner.displayName,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        eq(appointment.patientId, patientId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment.during, localDay(span.start, timeZone)),
        excludeId === undefined ? undefined : ne(appointment.id, excludeId),
      ),
    )
    .orderBy(asc(appointment.during));
  return rows.map((row) => ({
    kind: intersects(row.during, span) ? "overlap" : "sameDay",
    start: row.during.start,
    end: row.during.end,
    practitionerName: row.practitionerName,
    timeZone: row.timeZone,
  }));
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

/** Why the medical service, one of the practitioner's, or the patient cannot be booked; `null` when both can. */
export async function checkServiceAndPatient(
  tx: Transaction,
  practitionerId: string,
  medicalServiceId: string,
  patientId: string,
): Promise<{
  ok: false;
  reason: "notFound" | "medicalServiceInactive" | "patientInactive";
} | null> {
  const [service] = await tx
    .select({ active: medicalService.active })
    .from(medicalService)
    .where(
      and(
        eq(medicalService.id, medicalServiceId),
        eq(medicalService.practitionerId, practitionerId),
      ),
    );
  const [patientRow] = await tx
    .select({ active: patient.active })
    .from(patient)
    .where(eq(patient.id, patientId));
  if (!service || !patientRow) {
    return notFound;
  }
  if (!service.active) {
    return { ok: false, reason: "medicalServiceInactive" };
  }
  return patientRow.active ? null : { ok: false, reason: "patientInactive" };
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
  const { patientId, practitionerId, medicalServiceId, start, durationMinutes, receptionNote } =
    parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const refused = await checkServiceAndPatient(tx, found.id, medicalServiceId, patientId);
      if (refused) {
        return refused;
      }

      const { free, schedules } = await findFreeTimes(tx, found, {
        window: { start, end: new Date(+start + 1) },
        durationMinutes,
      });
      const slot = free.find((candidate) => +candidate.start === +start);
      if (!slot) {
        return { ok: false as const, reason: "notFree" as const };
      }
      const timeZone = schedules.find((row) => row.roomId === slot.roomId)!.timeZone;

      const warnings =
        input.confirmWarnings === true
          ? []
          : await findPatientWarnings(tx, patientId, span, timeZone);
      if (warnings.length > 0) {
        return { ok: false as const, reason: "patientWarning" as const, warnings };
      }

      const values = {
        patientId,
        practitionerId: found.id,
        medicalServiceId,
        roomId: slot.roomId,
        during: span,
        receptionNote,
      };
      const inserted = await insertAppointment(tx, {
        ...values,
        organizationId: actor.organizationId,
        createdBy: actor.userId,
      });
      if (!inserted.ok) {
        const fresh = await findFreeTimes(tx, found, {
          window: localDay(start, timeZone),
          durationMinutes,
        });
        return {
          ok: false as const,
          reason: "timeTaken" as const,
          freeStarts: toAvailableStarts(fresh.free, fresh.schedules),
        };
      }
      const { during: _during, ...fields } = values;
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "appointment",
        entityId: inserted.id,
        patientId,
        before: null,
        after: {
          ...fields,
          start: span.start.toISOString(),
          end: span.end.toISOString(),
          status: "booked",
        },
      });
      return { ok: true as const, appointment: { id: inserted.id } };
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
