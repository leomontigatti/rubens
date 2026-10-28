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
import type { MedicalServiceColor } from "#/lib/medical-services.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { outsideWorkingTime } from "#/lib/availability.ts";
import type { OutsideWorkingTime } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today } from "#/lib/schedules.ts";
import { patientName } from "#/lib/patients.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { booksForSome } from "#/server/appointments.ts";
import { meets } from "#/server/availability.ts";

// The "to reschedule" list (ui: "Turnos a reprogramar"), computed live and
// never stored (docs/domain/appointments.md § Rescheduling): every future
// booked or confirmed appointment, overbookings left out, that time off, a
// closure or a schedule change has left outside working time. Scoped as the
// calendar is: reception and admins see everyone's, a practitioner their own.
// Schedules in a deactivated room or office cover nothing, as in the free
// times. `database` is for tests, which pass a transaction running as the app
// role.
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
  color: MedicalServiceColor;
  officeName: string;
  roomName: string;
  /** The office's zone, to show the appointment in local time. */
  timeZone: string;
  reason: OutsideWorkingTime;
}

type Result<T> = ({ ok: true } & T) | { ok: false; reason: "forbidden" };

const forbidden = { ok: false, reason: "forbidden" } as const;

/** The future booked or confirmed appointments, overbookings left out, the actor may see. */
async function upcomingAppointments(tx: Transaction, actor: Actor) {
  return tx
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      practitionerName: practitioner.displayName,
      during: appointment.during,
      status: appointment.status,
      firstName: patient.firstName,
      lastName: patient.lastName,
      chosenName: patient.chosenName,
      medicalServiceName: medicalService.name,
      color: medicalService.color,
      officeId: office.id,
      officeName: office.name,
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
    .where(
      and(
        inArray(appointment.status, ["booked", "confirmed"]),
        eq(appointment.overbooking, false),
        gt(sql`lower(${appointment.during})`, new Date().toISOString()),
        actsForEveryone(actor) ? undefined : eq(member.userId, actor.userId),
      ),
    )
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

async function findToReschedule(tx: Transaction, actor: Actor): Promise<ToRescheduleEntry[]> {
  const rows = await upcomingAppointments(tx, actor);
  if (rows.length === 0) {
    return [];
  }
  const reach = {
    start: new Date(),
    end: new Date(Math.max(...rows.map((row) => +row.during.end))),
  };
  const workingTimeFor = await workingTimeOf(
    tx,
    [...new Set(rows.map((row) => row.practitionerId))],
    reach,
  );
  return rows.flatMap((row) => {
    const reason = outsideWorkingTime(row.during, row.officeId, workingTimeFor(row.practitionerId));
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
