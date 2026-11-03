import { and, asc, eq, or } from "drizzle-orm";

import { appointment, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { actsForEveryone } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import {
  appointmentIdSchema,
  appointmentUpdateSchema,
  isActiveStatus,
} from "#/lib/appointments.ts";
import type { AppointmentIdInput, AppointmentUpdate } from "#/lib/appointments.ts";

import { lockPlaced, movePlaced } from "#/server/appointment-placement.ts";
import type { PlacementRefusal } from "#/server/appointment-placement.ts";
import {
  booksForSome,
  findBookablePractitioner,
  selectDayAppointments,
  toDayAppointment,
} from "#/server/appointments.ts";
import type { DayAppointment } from "#/server/appointments.ts";
import { changedFields, recordAudit } from "#/server/audit.ts";

// One appointment on pages of its own: read as the calendar draws it, and its
// own fields, its room and its reception note, saved together in one
// transaction. Who may read or change it is whoever sees it in full on the
// calendar: reception and admins, or its own practitioner.
// `database` is for tests, which pass a transaction running as the app role.

export type AppointmentRecord =
  | {
      ok: true;
      appointment: DayAppointment;
      /** Its office's zone, and the rooms it can move to: the active ones and its own. */
      office: { timeZone: string; rooms: { id: string; name: string }[] };
    }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" };

export type AppointmentUpdateResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" | "practitionerInactive" }
  | PlacementRefusal<"sameTime">;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** The appointment, when the actor sees it in full; another practitioner's is not found. */
export async function getAppointment(
  actor: Actor,
  input: AppointmentIdInput,
  database?: AnyDatabase,
): Promise<AppointmentRecord> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentIdSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const [booked] = await selectDayAppointments(tx, actor).where(
        eq(appointment.id, parsed.data.appointmentId),
      );
      const own = booked?.practitionerUserId === actor.userId;
      if (!booked || !(actsForEveryone(actor) || own)) {
        return notFound;
      }
      return {
        ok: true as const,
        appointment: toDayAppointment(booked, { roles: actor.roles, own }, new Date()),
        office: {
          timeZone: booked.timeZone,
          rooms: await listMoveRooms(tx, booked.officeId, booked.roomId),
        },
      };
    },
    database,
  );
}

function listMoveRooms(tx: Transaction, officeId: string, currentRoomId: string) {
  return tx
    .select({ id: room.id, name: room.name })
    .from(room)
    .where(and(eq(room.officeId, officeId), or(eq(room.active, true), eq(room.id, currentRoomId))))
    .orderBy(asc(room.name));
}

/**
 * Saves the appointment's reception note, and moves it to `roomId` when
 * given. A new room, at the same time, is for an active appointment, and
 * needs space; when it is refused, the note is not saved either.
 */
export async function updateAppointment(
  actor: Actor,
  input: AppointmentUpdate,
  database?: AnyDatabase,
): Promise<AppointmentUpdateResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, roomId, receptionNote } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const placed = await lockPlaced(tx, appointmentId);
      if (!placed) {
        return notFound;
      }
      const found = await findBookablePractitioner(tx, actor, placed.practitionerId);
      if (!found.ok) {
        return found;
      }
      if (roomId !== undefined && roomId !== placed.roomId) {
        if (!isActiveStatus(placed.status)) {
          return notFound;
        }
        const moved = await movePlaced(
          tx,
          actor,
          found,
          placed,
          { kind: "sameTime", roomId },
          { confirmWarnings: false },
        );
        if (!moved.ok) {
          return moved;
        }
      }
      const changed = changedFields({ receptionNote: placed.receptionNote }, { receptionNote });
      if (changed) {
        await tx
          .update(appointment)
          .set({ receptionNote, updatedAt: new Date() })
          .where(eq(appointment.id, appointmentId));
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "appointment",
          entityId: appointmentId,
          patientId: placed.patientId,
          ...changed,
        });
      }
      return { ok: true as const };
    },
    database,
  );
}
