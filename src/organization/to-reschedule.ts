import { and, asc, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { outsideWorkingTime, outsideWorkingTimeWithin } from "#/lib/availability.ts";
import type { OutsideWorkingTime, WorkingTime } from "#/lib/availability.ts";
import { defaultTimeZone, placeReferenceSchema } from "#/lib/offices.ts";
import type { PlaceReference } from "#/lib/offices.ts";
import { patientName, patientReferenceSchema } from "#/lib/patients.ts";
import type { PatientReference } from "#/lib/patients.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { shiftDate, today } from "#/lib/schedules.ts";
import { memberReferenceSchema } from "#/lib/staff.ts";
import type { MemberReference } from "#/lib/staff.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { asRange, meets } from "#/organization/availability.ts";
import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import {
  appointment,
  closure,
  medicalService,
  member,
  office,
  patient,
  practitioner,
  room,
  schedule,
  timeOff,
} from "#/organization/schema.ts";

// The "to reschedule" list (ui: "Turnos a reprogramar"), computed live and
// never stored (docs/domain/appointments.md § Rescheduling): every future
// booked or confirmed appointment, overbookings left out, that time off, a
// closure or a schedule change has left outside working time, and, overbookings
// included, every one of a deactivated practitioner or patient, or in a
// deactivated room or office. Nothing here cancels one. Scoped as the calendar
// is: reception and admins see everyone's, a practitioner their own (the
// object's requirement lets every booking role read it). Schedules in a
// deactivated room or office cover nothing, as in the free times.

/** An appointment on the list, with what reception needs to call the patient. */
export interface ToRescheduleEntry {
  id: string;
  patientId: string;
  patientName: string;
  practitioner: { id: string; displayName: string };
  start: Date;
  end: Date;
  status: AppointmentStatus;
  medicalServiceName: string;
  color: PractitionerColor;
  officeName: string;
  roomName: string;
  /** The office's zone, to show the appointment in local time. */
  timeZone: string;
  reason: ToRescheduleReason;
}

/** Why an appointment is on the list. */
export type ToRescheduleReason =
  | OutsideWorkingTime
  | "practitionerInactive"
  | "patientInactive"
  | "officeInactive"
  | "roomInactive";

/** Where an appointment sits or a schedule runs. */
type Place = { roomId: string; officeId: string };

type CountResult = { ok: true; count: number } | { ok: false; reason: "invalidInput" };

const invalidInput = { ok: false, reason: "invalidInput" } as const;

/** The future booked or confirmed appointments `acting` may see, soonest first. */
function upcomingAppointments(writer: Writer, acting: Acting) {
  return writer
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      overbooking: appointment.overbooking,
      memberId: member.userId,
      practitionerActive: member.active,
      patientActive: patient.active,
      firstName: patient.firstName,
      lastName: patient.lastName,
      chosenName: patient.chosenName,
      medicalServiceName: medicalService.name,
      color: practitioner.color,
      officeId: office.id,
      officeActive: office.active,
      officeName: office.name,
      roomId: room.id,
      roomActive: room.active,
      roomName: room.name,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        inArray(appointment.status, ["booked", "confirmed"]),
        gt(appointment.startsAt, Date.now()),
        actsForEveryone(acting) ? undefined : eq(member.userId, acting.userId),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(appointment.id))
    .all()
    .map(({ startsAt, endsAt, ...row }) => ({ ...row, during: asRange({ startsAt, endsAt }) }));
}

type Upcoming = ReturnType<typeof upcomingAppointments>[number];

/**
 * What decides working time for `practitionerIds` from now to `reach`: their
 * schedules in active rooms and offices, their time off and every closure.
 */
function workingTimeOf(writer: Writer, practitionerIds: string[], reach: TimeRange) {
  const schedules = writer
    .select({
      practitionerId: schedule.practitionerId,
      officeId: office.id,
      roomId: room.id,
      timeZone: office.timeZone,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(room, and(eq(room.id, schedule.roomId), eq(room.active, true)))
    .innerJoin(office, and(eq(office.id, room.officeId), eq(office.active, true)))
    .where(
      and(
        inArray(schedule.practitionerId, practitionerIds),
        // An office in another zone than the default one may still be on yesterday.
        or(
          isNull(schedule.lastDate),
          gte(schedule.lastDate, shiftDate(today(defaultTimeZone), -1)),
        ),
      ),
    )
    .all();
  const timeOffRows = writer
    .select({
      practitionerId: timeOff.practitionerId,
      startsAt: timeOff.startsAt,
      endsAt: timeOff.endsAt,
    })
    .from(timeOff)
    .where(and(inArray(timeOff.practitionerId, practitionerIds), meets(timeOff, reach)))
    .all();
  const closures = writer
    .select({ officeId: closure.officeId, startsAt: closure.startsAt, endsAt: closure.endsAt })
    .from(closure)
    .where(meets(closure, reach))
    .all()
    .map((row) => ({ officeId: row.officeId, during: asRange(row) }));
  const byPractitioner = new Map<string, PractitionerWorkingTime>();
  return (practitionerId: string): PractitionerWorkingTime => {
    let found = byPractitioner.get(practitionerId);
    if (!found) {
      const workingTime: WorkingTime = {
        schedules: schedules.filter((row) => row.practitionerId === practitionerId),
        timeOff: timeOffRows.filter((row) => row.practitionerId === practitionerId).map(asRange),
        closures,
      };
      found = { workingTime, outside: outsideWorkingTimeWithin(workingTime, reach) };
      byPractitioner.set(practitionerId, found);
    }
    return found;
  };
}

/** A practitioner's working time, and the check of a span against it. */
interface PractitionerWorkingTime {
  workingTime: WorkingTime;
  outside: (span: TimeRange, officeId: string) => OutsideWorkingTime | null;
}

/**
 * The future booked or confirmed appointments `which` picks, with only what
 * `reasonFor` reads: the menu's count, and what a change sent to the list.
 */
function upcomingWhere(writer: Writer, which: SQL | undefined) {
  return writer
    .select({
      id: appointment.id,
      practitionerId: appointment.practitionerId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      overbooking: appointment.overbooking,
      practitionerActive: member.active,
      patientActive: patient.active,
      officeId: office.id,
      officeActive: office.active,
      roomActive: room.active,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        which,
        gt(appointment.startsAt, Date.now()),
        inArray(appointment.status, ["booked", "confirmed"]),
      ),
    )
    .all()
    .map(({ startsAt, endsAt, ...row }) => ({ ...row, during: asRange({ startsAt, endsAt }) }));
}

/** The appointments `which` picks that are on the list, everyone's. */
function listedAmong(writer: Writer, which: SQL | undefined) {
  const rows = upcomingWhere(writer, which);
  if (rows.length === 0) {
    return [];
  }
  const workingTimeFor = workingTimeOf(
    writer,
    [...new Set(rows.map((row) => row.practitionerId))],
    { start: new Date(), end: new Date(Math.max(...rows.map((row) => +row.during.end))) },
  );
  return rows.filter((row) => reasonFor(row, workingTimeFor(row.practitionerId).outside) !== null);
}

/**
 * The ids of the appointments on the list, of `practitionerIds` or of
 * everyone's when `null`: what a change to working time is read against,
 * before and after it.
 */
export function listedIds(writer: Writer, practitionerIds: string[] | null): Set<string> {
  const which =
    practitionerIds === null ? undefined : inArray(appointment.practitionerId, practitionerIds);
  return new Set(listedAmong(writer, which).map((row) => row.id));
}

/** Whether the appointment `appointmentId` is on the list now. */
export function isToReschedule(writer: Writer, appointmentId: string): boolean {
  return listedAmong(writer, eq(appointment.id, appointmentId)).length > 0;
}

type OutsideCheck = PractitionerWorkingTime["outside"];

/** What decides whether an appointment is on the list. */
type ListedBy = Pick<
  Upcoming,
  | "practitionerActive"
  | "patientActive"
  | "officeActive"
  | "roomActive"
  | "overbooking"
  | "during"
  | "officeId"
>;

/** Why the appointment is on the list; `null` when it is not. */
function reasonFor(row: ListedBy, outside: OutsideCheck): ToRescheduleReason | null {
  if (!row.practitionerActive) {
    return "practitionerInactive";
  }
  if (!row.patientActive) {
    return "patientInactive";
  }
  if (!row.officeActive) {
    return "officeInactive";
  }
  if (!row.roomActive) {
    return "roomInactive";
  }
  return row.overbooking ? null : outside(row.during, row.officeId);
}

/** The upcoming appointments `acting` may see, each with its practitioner's working time. */
function upcomingWithWorkingTime(writer: Writer, acting: Acting) {
  const rows = upcomingAppointments(writer, acting);
  if (rows.length === 0) {
    return [];
  }
  const reach = {
    start: new Date(),
    end: new Date(Math.max(...rows.map((row) => +row.during.end))),
  };
  const workingTimeFor = workingTimeOf(
    writer,
    [...new Set(rows.map((row) => row.practitionerId))],
    reach,
  );
  return rows.map((row) => ({ row, ...workingTimeFor(row.practitionerId) }));
}

function findToReschedule(writer: Writer, acting: Acting): ToRescheduleEntry[] {
  return upcomingWithWorkingTime(writer, acting).flatMap(({ row, outside }) => {
    const reason = reasonFor(row, outside);
    if (reason === null) {
      return [];
    }
    return [
      {
        id: row.id,
        patientId: row.patientId,
        patientName: patientName(row),
        practitioner: { id: row.practitionerId, displayName: row.practitionerName },
        start: row.during.start,
        end: row.during.end,
        status: row.status,
        medicalServiceName: row.medicalServiceName,
        color: row.color,
        officeName: row.officeName,
        roomName: row.roomName,
        timeZone: row.timeZone,
        reason,
      },
    ];
  });
}

/** The appointments to reschedule that `acting` may see, soonest first. */
export function listToReschedule(
  writer: Writer,
  acting: Acting,
): { ok: true; appointments: ToRescheduleEntry[] } {
  return { ok: true, appointments: findToReschedule(writer, acting) };
}

/**
 * How many appointments `acting`'s list holds, for the menu on every page:
 * the list's rule (`reasonFor`), over rows that carry only what it reads.
 */
export function countToReschedule(writer: Writer, acting: Acting): { ok: true; count: number } {
  const practitionerIds = writer
    .select({ id: practitioner.id })
    .from(practitioner)
    .where(actsForEveryone(acting) ? undefined : eq(practitioner.memberId, acting.userId))
    .all()
    .map((row) => row.id);
  if (practitionerIds.length === 0) {
    return { ok: true, count: 0 };
  }
  const listed = listedAmong(writer, inArray(appointment.practitionerId, practitionerIds));
  return { ok: true, count: listed.length };
}

/** How many appointments not on the list yet `sends` would send to it. */
function countSentToList(
  writer: Writer,
  acting: Acting,
  sends: (row: Upcoming, workingTime: WorkingTime) => boolean,
): number {
  return upcomingWithWorkingTime(writer, acting).filter(
    ({ row, workingTime, outside }) => reasonFor(row, outside) === null && sends(row, workingTime),
  ).length;
}

/** The patient's appointments deactivating them would send to the list. */
export function countPatientUpcoming(
  writer: Writer,
  acting: Acting,
  input: PatientReference,
): CountResult {
  const parsed = patientReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const count = countSentToList(writer, acting, (row) => row.patientId === parsed.data.id);
  return { ok: true, count };
}

/** The member's appointments as a practitioner, likewise. */
export function countMemberUpcoming(
  writer: Writer,
  acting: Acting,
  input: MemberReference,
): CountResult {
  const parsed = memberReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const count = countSentToList(writer, acting, (row) => row.memberId === parsed.data.memberId);
  return { ok: true, count };
}

/**
 * Whether deactivating the place `leaving` picks sends the appointment to the
 * list: it sits there, or only that place's schedules cover it.
 */
function placeSends(row: Upcoming, workingTime: WorkingTime, leaving: (where: Place) => boolean) {
  const remaining = {
    ...workingTime,
    schedules: workingTime.schedules.filter((at) => !leaving(at)),
  };
  return (
    leaving(row) ||
    reasonFor(row, (span, officeId) => outsideWorkingTime(span, officeId, remaining)) !== null
  );
}

/** The count for a place, as the question before deactivating it needs it. */
function countForPlace(
  writer: Writer,
  acting: Acting,
  input: PlaceReference,
  leaving: (id: string) => (where: Place) => boolean,
): CountResult {
  const parsed = placeReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const count = countSentToList(writer, acting, (row, workingTime) =>
    placeSends(row, workingTime, leaving(parsed.data.id)),
  );
  return { ok: true, count };
}

/** The appointments deactivating the room would send to the list. */
export function countRoomUpcoming(writer: Writer, acting: Acting, input: PlaceReference) {
  return countForPlace(writer, acting, input, (id) => (where) => where.roomId === id);
}

/** The appointments deactivating the office would send to the list. */
export function countOfficeUpcoming(writer: Writer, acting: Acting, input: PlaceReference) {
  return countForPlace(writer, acting, input, (id) => (where) => where.officeId === id);
}
