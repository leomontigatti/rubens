import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { AuditValues } from "#/lib/audit-fields.ts";
import { defaultTimeZone } from "#/lib/offices.ts";

import type { AuditAction } from "#/organization/audit.ts";
import { selectDayAppointments } from "#/organization/appointments.ts";
import type { Database } from "#/organization/database.ts";
import { findPatient, patientIdSchema } from "#/organization/patients.ts";
import {
  appointment,
  auditLog,
  medicalService,
  member,
  office,
  practitioner,
  room,
} from "#/organization/schema.ts";

// A patient's change history: every audit entry about them, their coverages,
// guardians and appointments included. Only an admin reads it (the object's
// requirement).

/** The appointment an entry is about, as it is now: what its title names it by. */
export interface HistoryAppointment {
  /** Unix milliseconds. */
  startsAt: number;
  /** The practitioner, by the name patients read. */
  practitioner: string;
  /** Its office's zone, which `startsAt` reads in. */
  timeZone: string;
}

/** The zones an appointment entry's times are shown in, one per side. */
export interface HistoryTimeZones {
  before: string;
  after: string;
}

export interface HistoryEntry {
  id: string;
  action: AuditAction;
  entityType: string;
  userId: string;
  /** `null` when the user is no longer a member. */
  userName: string | null;
  before: AuditValues | null;
  after: AuditValues | null;
  /** Unix milliseconds. */
  createdAt: number;
  /** An appointment entry's zones, to show each side's times in; `null` for other entries. */
  timeZones: HistoryTimeZones | null;
  /** An appointment entry's appointment; `null` for other entries. */
  appointment: HistoryAppointment | null;
}

// The ids an appointment's audit entry may hold, each shown by its name.
const namedFields = ["practitionerId", "medicalServiceId", "roomId"] as const;

type EntryRow = {
  entityType: string;
  entityId: string;
  before: AuditValues | null;
  after: AuditValues | null;
};

/**
 * What the history needs to show appointment entries without ids: each
 * entry's appointment and zones, and the names of the practitioners, medical services and
 * rooms the entries point at, by id. A side's times are in the zone of the
 * office of the room that side names, else of the appointment's office now.
 */
function appointmentContext(database: Database, patientId: string, entries: readonly EntryRow[]) {
  const appointmentEntries = entries.filter((entry) => entry.entityType === "appointment");
  const idsOf = (field: (typeof namedFields)[number]) => [
    ...new Set(
      appointmentEntries
        .flatMap((entry) => [entry.before?.[field], entry.after?.[field]])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const appointments =
    appointmentEntries.length === 0
      ? []
      : selectDayAppointments(database)
          .where(
            inArray(
              appointment.id,
              database
                .select({ id: auditLog.entityId })
                .from(auditLog)
                .where(
                  and(eq(auditLog.patientId, patientId), eq(auditLog.entityType, "appointment")),
                ),
            ),
          )
          .all();
  const practitioners = whereIn(idsOf("practitionerId"), (ids) =>
    database
      .select({ id: practitioner.id, name: practitioner.displayName })
      .from(practitioner)
      .where(inArray(practitioner.id, ids))
      .all(),
  );
  const services = whereIn(idsOf("medicalServiceId"), (ids) =>
    database
      .select({ id: medicalService.id, name: medicalService.name })
      .from(medicalService)
      .where(inArray(medicalService.id, ids))
      .all(),
  );
  const rooms = whereIn(idsOf("roomId"), (ids) =>
    database
      .select({ id: room.id, name: room.name, timeZone: office.timeZone })
      .from(room)
      .innerJoin(office, eq(office.id, room.officeId))
      .where(inArray(room.id, ids))
      .all(),
  );
  const current = new Map(
    appointments.map((row) => [
      row.id,
      { startsAt: row.startsAt, practitioner: row.practitionerName, timeZone: row.timeZone },
    ]),
  );
  const roomZones = new Map(rooms.map((row) => [row.id, row.timeZone]));
  return {
    timeZonesOf: (entry: EntryRow): HistoryTimeZones | null => {
      if (entry.entityType !== "appointment") {
        return null;
      }
      const zone = current.get(entry.entityId)?.timeZone ?? defaultTimeZone;
      const zoneOf = (values: AuditValues | null) => roomZones.get(String(values?.roomId)) ?? zone;
      return { before: zoneOf(entry.before), after: zoneOf(entry.after) };
    },
    appointmentOf: (entry: EntryRow): HistoryAppointment | null =>
      entry.entityType === "appointment" ? (current.get(entry.entityId) ?? null) : null,
    names: Object.fromEntries(
      [...practitioners, ...services, ...rooms].map((row) => [row.id, row.name]),
    ),
  };
}

/** The rows `select` finds for `ids`, with no query when there are none. */
function whereIn<T>(ids: string[], select: (ids: string[]) => T[]): T[] {
  return ids.length === 0 ? [] : select(ids);
}

/** Every audit entry about a patient, newest first. */
export function getPatientHistory(
  database: Database,
  input: { patientId: string },
):
  | {
      ok: true;
      entries: HistoryEntry[];
      /** The names of the practitioners, medical services and rooms the entries point at, by id. */
      names: Record<string, string>;
    }
  | { ok: false; reason: "notFound" } {
  const patientId = patientIdSchema.safeParse(input.patientId);
  if (!patientId.success || !findPatient(database, patientId.data)) {
    return { ok: false, reason: "notFound" };
  }
  const rows = database
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      userId: auditLog.userId,
      userName: member.name,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(member, eq(member.userId, auditLog.userId))
    .where(eq(auditLog.patientId, patientId.data))
    // Insertion order breaks a tie: two entries can share a millisecond.
    .orderBy(desc(auditLog.createdAt), desc(sql`${auditLog}.rowid`))
    .all();
  const { timeZonesOf, appointmentOf, names } = appointmentContext(database, patientId.data, rows);
  return {
    ok: true,
    entries: rows.map(({ entityId, ...row }) => ({
      ...row,
      action: row.action as AuditAction,
      timeZones: timeZonesOf({ ...row, entityId }),
      appointment: appointmentOf({ ...row, entityId }),
    })),
    names,
  };
}
