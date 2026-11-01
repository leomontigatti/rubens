import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";

import {
  appointment,
  medicalService,
  closure,
  member,
  office,
  patient,
  practitioner,
  room,
  schedule,
  timeOff,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { outsideWorkingTime } from "#/lib/availability.ts";
import type { OutsideWorkingTime, WorkingTime } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today } from "#/lib/schedules.ts";
import { patientName, patientReferenceSchema } from "#/lib/patients.ts";
import type { PatientReference } from "#/lib/patients.ts";
import { placeReferenceSchema } from "#/lib/offices.ts";
import type { PlaceReference } from "#/lib/offices.ts";
import { memberReferenceSchema } from "#/lib/staff.ts";
import type { MemberReference } from "#/lib/staff.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { booksForSome } from "#/server/appointments.ts";
import { meets } from "#/server/availability.ts";

// The "to reschedule" list (ui: "Turnos a reprogramar"), computed live and
// never stored (docs/domain/appointments.md § Rescheduling): every future
// booked or confirmed appointment, overbookings left out, that time off, a
// closure or a schedule change has left outside working time, and, overbookings
// included, every one of a deactivated practitioner or patient, or in a
// deactivated room or office. Scoped as the calendar is: reception and admins
// see everyone's, a practitioner their own. Schedules in a deactivated room or
// office cover nothing, as in the free times. `database` is for tests, which
// pass a transaction running as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

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

type Result<T> = ({ ok: true } & T) | { ok: false; reason: "forbidden" };

type CountResult = Result<{ count: number }> | { ok: false; reason: "invalidInput" };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

/** The appointments the list looks at. */
const upcoming = () =>
  and(
    inArray(appointment.status, ["booked", "confirmed"]),
    gt(sql`lower(${appointment.during})`, new Date().toISOString()),
  );

/** The future booked or confirmed appointments the actor may see. */
async function upcomingAppointments(tx: Transaction, actor: Actor) {
  return tx
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      during: appointment.during,
      status: appointment.status,
      overbooking: appointment.overbooking,
      memberId: member.id,
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
    .innerJoin(
      member,
      and(eq(member.id, practitioner.memberId), eq(member.organizationId, actor.organizationId)),
    )
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(and(upcoming(), actsForEveryone(actor) ? undefined : eq(member.userId, actor.userId)))
    .orderBy(asc(appointment.during));
}

/**
 * What decides working time for `practitionerIds` from now to `reach`: their
 * schedules in active rooms and offices, their time off and every closure.
 */
async function workingTimeOf(tx: Transaction, practitionerIds: string[], reach: TimeRange) {
  const schedules = await tx
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
    );
  const timeOffRows = await tx
    .select({ practitionerId: timeOff.practitionerId, during: timeOff.during })
    .from(timeOff)
    .where(and(inArray(timeOff.practitionerId, practitionerIds), meets(timeOff.during, reach)));
  const closures = await tx
    .select({ during: closure.during, officeId: closure.officeId })
    .from(closure)
    .where(meets(closure.during, reach));
  return (practitionerId: string) => ({
    schedules: schedules.filter((row) => row.practitionerId === practitionerId),
    timeOff: timeOffRows
      .filter((row) => row.practitionerId === practitionerId)
      .map((row) => row.during),
    closures,
  });
}

type Upcoming = Awaited<ReturnType<typeof upcomingAppointments>>[number];

/** Why the appointment is on the list; `null` when it is not. */
function reasonFor(row: Upcoming, workingTime: WorkingTime): ToRescheduleReason | null {
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
  return row.overbooking ? null : outsideWorkingTime(row.during, row.officeId, workingTime);
}

/** The working time of `rows`' practitioners, up to the last of them. */
function workingTimeOfRows(tx: Transaction, rows: Upcoming[]) {
  const reach = {
    start: new Date(),
    end: new Date(Math.max(...rows.map((row) => +row.during.end))),
  };
  return workingTimeOf(tx, [...new Set(rows.map((row) => row.practitionerId))], reach);
}

async function findToReschedule(tx: Transaction, actor: Actor): Promise<ToRescheduleEntry[]> {
  const rows = await upcomingAppointments(tx, actor);
  if (rows.length === 0) {
    return [];
  }
  const workingTimeFor = await workingTimeOfRows(tx, rows);
  return rows.flatMap((row) => {
    const reason = reasonFor(row, workingTimeFor(row.practitionerId));
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

/** The appointments to reschedule that the actor may see, soonest first. */
export async function listToReschedule(
  actor: Actor,
  database?: AnyDatabase,
): Promise<Result<{ appointments: ToRescheduleEntry[] }>> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => ({ ok: true as const, appointments: await findToReschedule(tx, actor) }),
    database,
  );
}

/** How many appointments the actor's list holds, for the menu. */
export async function countToReschedule(
  actor: Actor,
  database?: AnyDatabase,
): Promise<Result<{ count: number }>> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => ({ ok: true as const, count: (await findToReschedule(tx, actor)).length }),
    database,
  );
}

/** How many appointments not on the list yet `sends` would send to it. */
async function countSentToList(
  tx: Transaction,
  actor: Actor,
  sends: (row: Upcoming, workingTime: WorkingTime) => boolean,
) {
  const rows = await upcomingAppointments(tx, actor);
  if (rows.length === 0) {
    return 0;
  }
  const workingTimeFor = await workingTimeOfRows(tx, rows);
  return rows.filter((row) => {
    const workingTime = workingTimeFor(row.practitionerId);
    return reasonFor(row, workingTime) === null && sends(row, workingTime);
  }).length;
}

/** The patient's appointments deactivating them would send to the list. */
export async function countPatientUpcoming(
  actor: Actor,
  input: PatientReference,
  database?: AnyDatabase,
): Promise<CountResult> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = patientReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => ({
      ok: true as const,
      count: await countSentToList(tx, actor, (row) => row.patientId === parsed.data.id),
    }),
    database,
  );
}

/** The member's appointments as a practitioner, likewise. */
export async function countMemberUpcoming(
  actor: Actor,
  input: MemberReference,
  database?: AnyDatabase,
): Promise<CountResult> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = memberReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => ({
      ok: true as const,
      count: await countSentToList(tx, actor, (row) => row.memberId === parsed.data.memberId),
    }),
    database,
  );
}

/**
 * Whether deactivating the place `leaving` picks sends the appointment to the
 * list: it sits there, or only that place's schedules cover it.
 */
function placeSends(row: Upcoming, workingTime: WorkingTime, leaving: (where: Place) => boolean) {
  const remaining = workingTime.schedules.filter((schedule) => !leaving(schedule));
  return leaving(row) || reasonFor(row, { ...workingTime, schedules: remaining }) !== null;
}

/** The count for a place, as the question before deactivating it needs it. */
async function countForPlace(
  actor: Actor,
  input: PlaceReference,
  leaving: (id: string) => (where: Place) => boolean,
  database?: AnyDatabase,
): Promise<CountResult> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = placeReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => ({
      ok: true as const,
      count: await countSentToList(tx, actor, (row, workingTime) =>
        placeSends(row, workingTime, leaving(parsed.data.id)),
      ),
    }),
    database,
  );
}

/** The appointments deactivating the room would send to the list. */
export function countRoomUpcoming(actor: Actor, input: PlaceReference, database?: AnyDatabase) {
  return countForPlace(actor, input, (id) => (where) => where.roomId === id, database);
}

/** The appointments deactivating the office would send to the list. */
export function countOfficeUpcoming(actor: Actor, input: PlaceReference, database?: AnyDatabase) {
  return countForPlace(actor, input, (id) => (where) => where.officeId === id, database);
}
