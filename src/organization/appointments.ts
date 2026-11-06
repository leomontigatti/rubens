import { and, asc, eq } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import { decideUndo, statusActionsFor } from "#/lib/appointment-statuses.ts";
import type { StatusAction, StatusActor } from "#/lib/appointment-statuses.ts";
import { bookingInputSchema, overbookingInputSchema } from "#/lib/appointments.ts";
import type {
  AppointmentStatus,
  BookingInput,
  OverbookingInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";
import { patientName } from "#/lib/patients.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { placeAtTime } from "#/organization/appointment-placement.ts";
import type { NewPlacement, PlacementRefusal } from "#/organization/appointment-placement.ts";
import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPatient, patientIdSchema } from "#/organization/patients.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import {
  appointment,
  medicalService,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";

// Appointments (ui: "Turno"). Every staff role books (the object's
// requirement): reception and admins for any practitioner, a practitioner for
// themselves. A booking is taken only at a free start, in the room of the
// schedule it falls in; an overbooking (ui: "Sobreturno") at any start, in a
// room with space. Where each goes and why it may not is the placement
// module's (`appointment-placement.ts`); the check and the insert run in one
// synchronous transaction (ADR-0008). Every booking is written to the audit
// log, about its patient.

type Refusal = "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";

type VisitRefusal = {
  ok: false;
  reason: "notFound" | "medicalServiceInactive" | "patientInactive";
};

type BookingResultOf<Kind extends NewPlacement["kind"]> =
  | { ok: true; appointment: { id: string } }
  | { ok: false; reason: Refusal }
  | VisitRefusal
  | PlacementRefusal<Kind>;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** The practitioner, when `acting` may book for them and they are active. */
function findBookablePractitioner(writer: Writer, acting: Acting, practitionerId: string) {
  const found = findPractitioner(writer, acting, practitionerId);
  if (!found) {
    return notFound;
  }
  if (!actsForEveryone(acting) && !found.canEdit) {
    return forbidden;
  }
  if (!found.active) {
    return { ok: false as const, reason: "practitionerInactive" as const };
  }
  return { ok: true as const, ...found };
}

/** What the new appointment is for. */
interface Visit {
  patientId: string;
  medicalServiceId: string;
  receptionNote: string | null;
}

/** Why the medical service, one of the practitioner's, or the patient cannot be booked; `null` when both can. */
function checkVisit(
  writer: Writer,
  practitionerId: string,
  { medicalServiceId, patientId }: Visit,
): VisitRefusal | null {
  const service = writer
    .select({ active: medicalService.active })
    .from(medicalService)
    .where(
      and(
        eq(medicalService.id, medicalServiceId),
        eq(medicalService.practitionerId, practitionerId),
      ),
    )
    .get();
  const found = findPatient(writer, patientId);
  if (!service || !found) {
    return notFound;
  }
  if (!service.active) {
    return { ok: false, reason: "medicalServiceInactive" };
  }
  return found.active ? null : { ok: false, reason: "patientInactive" };
}

/** Books a new appointment where the placement goes, and audits it. */
function placeNew<Kind extends NewPlacement["kind"]>(
  database: Database,
  acting: Acting,
  input: Visit & { practitionerId: string; confirmWarnings: boolean },
  placement: Extract<NewPlacement, { kind: Kind }>,
): BookingResultOf<Kind> {
  const { practitionerId, confirmWarnings, ...visit } = input;
  return database.transaction((tx): BookingResultOf<Kind> => {
    const found = findBookablePractitioner(tx, acting, practitionerId);
    if (!found.ok) {
      return found;
    }
    const refused = checkVisit(tx, found.id, visit);
    if (refused) {
      return refused;
    }
    const where = placeAtTime<Kind>(tx, found, visit.patientId, placement, confirmWarnings);
    if (!where.ok) {
      return where;
    }
    const { span } = placement;
    const fields = {
      ...visit,
      practitionerId: found.id,
      roomId: where.roomId,
      ...(placement.kind === "overbooking" ? { overbooking: true } : {}),
    };
    const created = tx
      .insert(appointment)
      .values({ ...fields, startsAt: +span.start, endsAt: +span.end, createdBy: acting.userId })
      .returning({ id: appointment.id })
      .get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "appointment",
      entityId: created.id,
      patientId: visit.patientId,
      before: null,
      after: {
        ...fields,
        start: span.start.toISOString(),
        end: span.end.toISOString(),
        status: "booked",
      },
    });
    return { ok: true, appointment: created };
  });
}

const spanOf = (start: Date, durationMinutes: number): TimeRange => ({
  start,
  end: new Date(+start + durationMinutes * 60_000),
});

/**
 * Books the patient at a free start of the practitioner's, for the duration.
 * The patient's other appointments that day warn until `confirmWarnings`.
 */
export function bookAppointment(
  database: Database,
  acting: Acting,
  input: BookingInput & WarningConfirmation,
): BookingResultOf<"freeStart"> {
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { start, durationMinutes, ...visit } = parsed.data;
  return placeNew(
    database,
    acting,
    { ...visit, confirmWarnings: input.confirmWarnings === true },
    { kind: "freeStart", span: spanOf(start, durationMinutes) },
  );
}

/**
 * Books an overbooking: at any start, over the practitioner's own appointments
 * or outside their schedules, though never in time off or a closure. Inside a
 * schedule it takes that schedule's room unless another is picked; outside
 * them a room must be picked. The patient's other appointments that day warn
 * until `confirmWarnings`.
 */
export function bookOverbooking(
  database: Database,
  acting: Acting,
  input: OverbookingInput & WarningConfirmation,
): BookingResultOf<"overbooking"> {
  const parsed = overbookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { start, durationMinutes, roomId, ...visit } = parsed.data;
  return placeNew(
    database,
    acting,
    { ...visit, confirmWarnings: input.confirmWarnings === true },
    { kind: "overbooking", span: spanOf(start, durationMinutes), pickedRoomId: roomId },
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

/**
 * The calendar's reading of appointments, joined to their practitioner, room,
 * office, patient and medical service.
 */
export function selectDayAppointments(writer: Writer) {
  return writer
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      practitionerUserId: practitioner.memberId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
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
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId));
}

export type DayAppointmentRow = ReturnType<ReturnType<typeof selectDayAppointments>["all"]>[number];

/** An appointment as the calendar draws it, with what `viewer` may do to it at `now`. */
export function toDayAppointment(
  booked: DayAppointmentRow,
  viewer: StatusActor,
  now: Date,
): DayAppointment {
  const start = new Date(booked.startsAt);
  const undo = decideUndo(
    { ...booked, statusChangedAt: new Date(booked.statusChangedAt) },
    viewer,
    now,
  );
  return {
    id: booked.id,
    practitionerId: booked.practitionerId,
    practitionerName: booked.practitionerName,
    patientId: booked.patientId,
    start,
    end: new Date(booked.endsAt),
    status: booked.status,
    actions: statusActionsFor({ status: booked.status, start }, viewer, now),
    undoStatus: undo.ok ? undo.status : null,
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

export interface PatientAppointment {
  id: string;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  overbooking: boolean;
  practitionerName: string;
  medicalServiceName: string;
  officeName: string;
  roomName: string;
  /** The office's zone, to show the times in local time. */
  timeZone: string;
  cancelledBy: "patient" | "business" | null;
  cancellationReason: string | null;
}

/**
 * A patient's appointments (docs/domain/appointments.md § Patient history),
 * cancellations and no-shows included: upcoming ones soonest first, then past
 * ones latest first; one is past once it ends. Reception and admins see all of
 * them, a practitioner only those with themselves.
 */
export function listPatientAppointments(
  writer: Writer,
  acting: Acting,
  input: { patientId: string },
):
  | { ok: true; upcoming: PatientAppointment[]; past: PatientAppointment[] }
  | { ok: false; reason: "notFound" } {
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success || !findPatient(writer, patientId.data)) {
    return notFound;
  }
  const rows = writer
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      overbooking: appointment.overbooking,
      practitionerName: practitioner.displayName,
      medicalServiceName: medicalService.name,
      officeName: office.name,
      roomName: room.name,
      timeZone: office.timeZone,
      cancelledBy: appointment.cancelledBy,
      cancellationReason: appointment.cancellationReason,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        eq(appointment.patientId, patientId.data),
        actsForEveryone(acting) ? undefined : eq(practitioner.memberId, acting.userId),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(appointment.id))
    .all();
  const now = Date.now();
  const appointments = rows.map(({ startsAt, endsAt, ...row }) => ({
    ...row,
    start: new Date(startsAt),
    end: new Date(endsAt),
  }));
  return {
    ok: true,
    upcoming: appointments.filter((row) => +row.end > now),
    past: appointments.filter((row) => +row.end <= now).reverse(),
  };
}
