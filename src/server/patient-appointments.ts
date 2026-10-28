import { and, asc, eq } from "drizzle-orm";
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
import type { AnyDatabase } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";

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
  typeName: string;
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
          typeName: medicalService.name,
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
