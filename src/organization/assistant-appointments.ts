import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { appointmentDay, appointmentTime } from "#/lib/template-filling.ts";

import type { Database } from "#/organization/database.ts";
import { upcomingStatuses } from "#/organization/template-messages.ts";
import { appointment, medicalService, office, practitioner, room } from "#/organization/schema.ts";

// The appointments a patient assistant's turn may speak of and act on
// (docs/domain/assistant.md § For patients): the upcoming ones of the patients
// the conversation's number is the message contact of, with what the patient
// may be told of each and nothing clinical.

/** The upcoming appointments of `patientIds`, with what the patient may be told of each. */
export function upcomingAppointments(database: Database, patientIds: string[], now: number) {
  if (patientIds.length === 0) {
    return [];
  }
  return database
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      medicalService: medicalService.name,
      practitioner: practitioner.displayName,
      office: office.name,
      address: office.address,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(
      and(
        inArray(appointment.patientId, patientIds),
        inArray(appointment.status, upcomingStatuses),
        gt(appointment.startsAt, now),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(appointment.id))
    .all();
}

export type Upcoming = ReturnType<typeof upcomingAppointments>[number];

/** The day and the time of `upcoming` as the templates write them, in its office's zone. */
export function whenOf(upcoming: Upcoming) {
  const start = new Date(upcoming.startsAt);
  return {
    date: appointmentDay(start, upcoming.timeZone),
    time: appointmentTime(start, upcoming.timeZone),
  };
}
