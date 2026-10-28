import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import {
  appointment,
  appointmentType,
  member,
  office,
  patient,
  practitioner,
  room,
  schedule,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import { decideUndo, statusActionsFor } from "#/lib/appointment-statuses.ts";
import type { StatusAction, StatusActor } from "#/lib/appointment-statuses.ts";
import type { AppointmentTypeColor } from "#/lib/appointment-types.ts";
import {
  activeAppointmentStatuses,
  bookingInputSchema,
  officeDayQuerySchema,
} from "#/lib/appointments.ts";
import type {
  AppointmentStatus,
  BookingInput,
  OfficeDayQuery,
  WarningConfirmation,
} from "#/lib/appointments.ts";
import { appliesOn } from "#/lib/availability.ts";
import { patientName } from "#/lib/patients.ts";
import { instantOf, toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { recordAudit } from "#/server/audit.ts";
import { findFreeTimes, meets, toAvailableStarts } from "#/server/availability.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Appointments (ui: "Turno"). Reception and admins book for any practitioner,
// a practitioner for themselves. A booking is taken only at a free time, in
// the room of the schedule it falls in. Two bookings racing for one time are
// settled by the exclusion constraint `appointment_practitioner_overlap`
// (migration 0013): the loser gets "timeTaken" with fresh free times. Every
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
  | "appointmentTypeInactive"
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

const overlapConstraint = "appointment_practitioner_overlap";

/** Whether the actor may book for any practitioner. */
function booksForAnyone(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("receptionist");
}

/** Whether the actor may book at all, before any row is read. */
export function booksForSome(actor: Actor): boolean {
  return booksForAnyone(actor) || actor.roles.includes("practitioner");
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
    if (violates(error, overlapConstraint)) {
      return { ok: false, reason: "timeTaken" };
    }
    throw error;
  }
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
    if (violates(error, overlapConstraint)) {
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
  if (!booksForAnyone(actor) && !found.canEdit) {
    return forbidden;
  }
  if (!found.active) {
    return { ok: false as const, reason: "practitionerInactive" as const };
  }
  return { ok: true as const, ...found };
}

/** Why the type, one of the practitioner's, or the patient cannot be booked; `null` when both can. */
export async function checkTypeAndPatient(
  tx: Transaction,
  practitionerId: string,
  appointmentTypeId: string,
  patientId: string,
): Promise<{
  ok: false;
  reason: "notFound" | "appointmentTypeInactive" | "patientInactive";
} | null> {
  const [type] = await tx
    .select({ active: appointmentType.active })
    .from(appointmentType)
    .where(
      and(
        eq(appointmentType.id, appointmentTypeId),
        eq(appointmentType.practitionerId, practitionerId),
      ),
    );
  const [patientRow] = await tx
    .select({ active: patient.active })
    .from(patient)
    .where(eq(patient.id, patientId));
  if (!type || !patientRow) {
    return notFound;
  }
  if (!type.active) {
    return { ok: false, reason: "appointmentTypeInactive" };
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
  const { patientId, practitionerId, appointmentTypeId, start, durationMinutes, receptionNote } =
    parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return withTenant(
    actor,
    async (tx) => {
      const found = await findBookablePractitioner(tx, actor, practitionerId);
      if (!found.ok) {
        return found;
      }
      const refused = await checkTypeAndPatient(tx, found.id, appointmentTypeId, patientId);
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
        appointmentTypeId,
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

/** An appointment as the day view draws it. */
export interface DayAppointment {
  id: string;
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
  typeName: string;
  color: AppointmentTypeColor;
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
  typeName: appointmentType.name,
  color: appointmentType.color,
  roomId: appointment.roomId,
  roomName: room.name,
  officeId: office.id,
  timeZone: office.timeZone,
  receptionNote: appointment.receptionNote,
};

/** The calendar's reading of appointments, joined to their room, office, patient and type. */
export function selectDayAppointments(tx: Transaction) {
  return tx
    .select(dayAppointmentColumns)
    .from(appointment)
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId));
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
    typeName: booked.typeName,
    color: booked.color,
    roomId: booked.roomId,
    roomName: booked.roomName,
    officeId: booked.officeId,
    receptionNote: booked.receptionNote,
  };
}

/** One practitioner's column of the office day view. */
export interface DayColumn {
  practitioner: { id: string; displayName: string };
  /** Each schedule's span that day at the office. */
  schedules: { start: Date; end: Date; roomName: string }[];
  appointments: DayAppointment[];
  /** Free starts a grid step long, each with the room a booking there takes. */
  freeStarts: { start: Date; roomId: string; roomName: string }[];
  gridMinutes: number;
}

/**
 * One office's local day: a column per practitioner with a schedule or an
 * appointment there that day, by name. Cancelled appointments are left out
 * unless asked for. A practitioner who neither books for anyone sees only
 * their own column.
 */
export async function getOfficeDay(
  actor: Actor,
  input: OfficeDayQuery,
  database?: AnyDatabase,
): Promise<
  | {
      ok: true;
      office: { id: string; name: string; timeZone: string };
      day: TimeRange;
      /** The office's active rooms, where an appointment can be moved or an overbooking booked. */
      rooms: { id: string; name: string }[];
      columns: DayColumn[];
    }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" }
> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = officeDayQuerySchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { officeId, date, includeCancelled } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [found] = await tx
        .select({ id: office.id, name: office.name, timeZone: office.timeZone })
        .from(office)
        .where(eq(office.id, officeId));
      if (!found) {
        return notFound;
      }
      const day = toTimeRange({ kind: "days", firstDate: date, lastDate: date }, found.timeZone);
      const rooms = await tx
        .select({ id: room.id, name: room.name })
        .from(room)
        .where(and(eq(room.officeId, found.id), eq(room.active, true)))
        .orderBy(asc(room.name));

      const scheduleRows = (
        await tx
          .select({
            practitionerId: schedule.practitionerId,
            roomName: room.name,
            weekdays: schedule.weekdays,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            firstDate: schedule.firstDate,
            lastDate: schedule.lastDate,
          })
          .from(schedule)
          .innerJoin(room, and(eq(room.id, schedule.roomId), eq(room.active, true)))
          .where(eq(room.officeId, found.id))
      ).filter((row) => appliesOn(row, date));
      const appointmentRows = await selectDayAppointments(tx)
        .where(
          and(
            eq(room.officeId, found.id),
            includeCancelled ? undefined : ne(appointment.status, "cancelled"),
            meets(appointment.during, day),
          ),
        )
        .orderBy(asc(appointment.during));

      const presentIds = [
        ...new Set([
          ...scheduleRows.map((row) => row.practitionerId),
          ...appointmentRows.map((row) => row.practitionerId),
        ]),
      ];
      if (presentIds.length === 0) {
        return { ok: true as const, office: found, day, rooms, columns: [] };
      }
      const practitioners = (
        await tx
          .select({
            id: practitioner.id,
            displayName: practitioner.displayName,
            gridMinutes: practitioner.gridMinutes,
            userId: member.userId,
            role: member.role,
            active: member.active,
          })
          .from(practitioner)
          .innerJoin(
            member,
            and(
              eq(member.id, practitioner.memberId),
              eq(member.organizationId, actor.organizationId),
            ),
          )
          .where(inArray(practitioner.id, presentIds))
          .orderBy(asc(practitioner.displayName))
      ).filter((row) => booksForAnyone(actor) || row.userId === actor.userId);

      const now = new Date();
      const columns: DayColumn[] = [];
      for (const row of practitioners) {
        const viewer = { roles: actor.roles, own: row.userId === actor.userId };
        const bookable = row.active && parseRoles(row.role).includes("practitioner");
        const { free, schedules } = bookable
          ? await findFreeTimes(tx, row, {
              window: day,
              durationMinutes: row.gridMinutes,
              officeId: found.id,
            })
          : { free: [], schedules: [] };
        const roomNames = new Map(schedules.map((where) => [where.roomId, where.roomName]));
        columns.push({
          practitioner: { id: row.id, displayName: row.displayName },
          gridMinutes: row.gridMinutes,
          schedules: scheduleRows
            .filter((where) => where.practitionerId === row.id)
            .map((where) => ({
              start: instantOf(date, where.startTime, found.timeZone),
              end: instantOf(date, where.endTime, found.timeZone),
              roomName: where.roomName,
            }))
            .sort((a, b) => +a.start - +b.start),
          appointments: appointmentRows
            .filter((booked) => booked.practitionerId === row.id)
            .map((booked) => toDayAppointment(booked, viewer, now)),
          freeStarts: free.map((slot) => ({
            start: slot.start,
            roomId: slot.roomId,
            roomName: roomNames.get(slot.roomId)!,
          })),
        });
      }
      return { ok: true as const, office: found, day, rooms, columns };
    },
    database,
  );
}
