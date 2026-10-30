import { and, asc, eq, inArray } from "drizzle-orm";
import * as z from "zod";

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
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import type { AuditValues } from "#/server/audit.ts";

import { booksForSome } from "#/server/appointments.ts";

// A patient's appointments, past and upcoming, with their statuses
// (docs/domain/appointments.md § Patient history): cancellations and no-shows
// included. Reception and admins see all of them, a practitioner only those
// with themselves. `database` is for tests, which pass a transaction running
// as the app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// the query on it names the actor's organization itself.

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

const patientIdSchema = z.uuid();

/** Upcoming appointments soonest first, then past ones latest first; one is past once it ends. */
export async function listPatientAppointments(
  actor: Actor,
  input: { patientId: string },
  database?: AnyDatabase,
): Promise<
  | { ok: true; upcoming: PatientAppointment[]; past: PatientAppointment[] }
  | { ok: false; reason: "forbidden" | "notFound" }
> {
  if (!booksForSome(actor)) {
    return { ok: false, reason: "forbidden" };
  }
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success) {
    return { ok: false, reason: "notFound" };
  }
  return withTenant(
    actor,
    async (tx) => {
      const [found] = await tx
        .select({ id: patient.id })
        .from(patient)
        .where(eq(patient.id, patientId.data));
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const rows = await tx
        .select({
          id: appointment.id,
          during: appointment.during,
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
        .innerJoin(
          member,
          and(
            eq(member.id, practitioner.memberId),
            eq(member.organizationId, actor.organizationId),
          ),
        )
        .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
        .innerJoin(room, eq(room.id, appointment.roomId))
        .innerJoin(office, eq(office.id, room.officeId))
        .where(
          and(
            eq(appointment.patientId, found.id),
            actsForEveryone(actor) ? undefined : eq(member.userId, actor.userId),
          ),
        )
        .orderBy(asc(appointment.during));
      const now = new Date();
      const appointments = rows.map(({ during, ...row }) => ({ ...row, ...during }));
      return {
        ok: true as const,
        upcoming: appointments.filter((row) => row.end > now),
        past: appointments.filter((row) => row.end <= now).reverse(),
      };
    },
    database,
  );
}

// The ids an appointment's audit entry may hold, each shown by its name.
const namedFields = ["practitionerId", "medicalServiceId", "roomId"] as const;

/** The zones an appointment entry's times are shown in, one per side. */
export interface HistoryTimeZones {
  before: string;
  after: string;
}

/**
 * What the change history needs to show appointment entries without ids:
 * each entry's zones, and the names of the practitioners, medical services
 * and rooms the entries point at, by id. A side's times are in the zone of
 * the office of the room that side names, else of the appointment's office now.
 */
export async function appointmentHistoryContext(
  tx: Transaction,
  entries: readonly {
    entityType: string;
    entityId: string;
    before: AuditValues | null;
    after: AuditValues | null;
  }[],
): Promise<{
  timeZonesOf: (entry: (typeof entries)[number]) => HistoryTimeZones | null;
  names: Record<string, string>;
}> {
  const appointmentEntries = entries.filter((entry) => entry.entityType === "appointment");
  const idsOf = (field: (typeof namedFields)[number]) => [
    ...new Set(
      appointmentEntries
        .flatMap((entry) => [entry.before?.[field], entry.after?.[field]])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const appointmentIds = [...new Set(appointmentEntries.map((entry) => entry.entityId))];
  const zones = await selectWhereIn(appointmentIds, (ids) =>
    tx
      .select({ id: appointment.id, timeZone: office.timeZone })
      .from(appointment)
      .innerJoin(room, eq(room.id, appointment.roomId))
      .innerJoin(office, eq(office.id, room.officeId))
      .where(inArray(appointment.id, ids)),
  );
  const practitioners = await selectWhereIn(idsOf("practitionerId"), (ids) =>
    tx
      .select({ id: practitioner.id, name: practitioner.displayName })
      .from(practitioner)
      .where(inArray(practitioner.id, ids)),
  );
  const services = await selectWhereIn(idsOf("medicalServiceId"), (ids) =>
    tx
      .select({ id: medicalService.id, name: medicalService.name })
      .from(medicalService)
      .where(inArray(medicalService.id, ids)),
  );
  const rooms = await selectWhereIn(idsOf("roomId"), (ids) =>
    tx
      .select({ id: room.id, name: room.name, timeZone: office.timeZone })
      .from(room)
      .innerJoin(office, eq(office.id, room.officeId))
      .where(inArray(room.id, ids)),
  );
  const currentZones = new Map(zones.map((row) => [row.id, row.timeZone]));
  const roomZones = new Map(rooms.map((row) => [row.id, row.timeZone]));
  return {
    timeZonesOf: (entry) => {
      if (entry.entityType !== "appointment") {
        return null;
      }
      const current = currentZones.get(entry.entityId) ?? defaultTimeZone;
      const zoneOf = (values: AuditValues | null) =>
        roomZones.get(String(values?.roomId)) ?? current;
      return { before: zoneOf(entry.before), after: zoneOf(entry.after) };
    },
    names: Object.fromEntries(
      [...practitioners, ...services, ...rooms].map((row) => [row.id, row.name]),
    ),
  };
}

/** The rows `select` finds for `ids`, with no query when there are none. */
async function selectWhereIn<T>(
  ids: string[],
  select: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  return ids.length === 0 ? [] : select(ids);
}
