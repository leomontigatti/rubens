import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { formatDay, formatTime } from "#/lib/dates.ts";

import type { Database } from "#/organization/database.ts";
import { upcomingStatuses } from "#/organization/template-messages.ts";
import { appointment, medicalService, office, practitioner, room } from "#/organization/schema.ts";
import { patientsReachedAt } from "#/organization/whatsapp-messages.ts";

// The appointments a patient assistant's turn may speak of and act on
// (docs/domain/assistant.md § For patients): the upcoming ones of the patients
// the conversation's number is the message contact of, with what the patient
// may be told of each and nothing clinical.

/** The upcoming appointments of the patients `phone` reaches, with what the patient may be told of each. */
export function upcomingAppointments(database: Database, phone: string, now: number) {
  return database
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      medicalService: medicalService.name,
      practitioner: practitioner.displayName,
      /** What the practitioner treats, so the model tells whose a health question is; none when unset. */
      specialty: practitioner.specialty,
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
        inArray(appointment.patientId, patientsReachedAt(database, phone)),
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
    date: formatDay(start, upcoming.timeZone),
    time: formatTime(start, upcoming.timeZone),
  };
}
