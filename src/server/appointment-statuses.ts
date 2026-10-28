import { eq } from "drizzle-orm";

import { appointment, office, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { decideStatusChange, decideUndo } from "#/lib/appointment-statuses.ts";
import type { StatusAction, StatusActor } from "#/lib/appointment-statuses.ts";
import { appointmentIdSchema, cancellationSchema, statusChangeSchema } from "#/lib/appointments.ts";
import type {
  AppointmentIdInput,
  AppointmentStatus,
  CancellationInput,
  StatusChangeInput,
} from "#/lib/appointments.ts";

import { booksForSome, updateAppointment } from "#/server/appointments.ts";
import { changedFields, recordAudit } from "#/server/audit.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Status changes (docs/domain/appointments.md § Statuses): confirming,
// checking in, attended, no-show and cancelling, each decided by the pure
// module `#/lib/appointment-statuses.ts`, and the same-day undo of the last
// one. Cancelled and no-show appointments stop holding the practitioner's
// time; an undo that brings one back to a time taken since is "timeTaken".
// Every change and undo is audited, about the appointment's patient.
// `database` is for tests, which pass a transaction running as the app role.

export type StatusChangeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalidInput"
        | "notFound"
        | "notAllowed"
        | "beforeStart"
        | "nothingToUndo"
        | "tooLate"
        | "timeTaken";
    };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** The appointment as a status change reads it, and the actor as the rules see them. */
async function findForChange(tx: Transaction, actor: Actor, appointmentId: string) {
  const [row] = await tx
    .select({
      practitionerId: appointment.practitionerId,
      patientId: appointment.patientId,
      during: appointment.during,
      status: appointment.status,
      previousStatus: appointment.previousStatus,
      statusChangedAt: appointment.statusChangedAt,
      cancelledBy: appointment.cancelledBy,
      cancellationReason: appointment.cancellationReason,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(appointment.id, appointmentId));
  if (!row) {
    return undefined;
  }
  const found = await findPractitioner(tx, actor, row.practitionerId, false);
  const statusActor: StatusActor = { roles: actor.roles, own: found?.canEdit === true };
  return { ...row, start: row.during.start, actor: statusActor };
}

type Current = NonNullable<Awaited<ReturnType<typeof findForChange>>>;

/** Writes the new status, keeping the one it replaces for the undo, and audits it. */
async function writeStatus(
  tx: Transaction,
  actor: Actor,
  appointmentId: string,
  current: Current,
  next: {
    status: AppointmentStatus;
    previousStatus: AppointmentStatus | null;
    cancelledBy: Current["cancelledBy"];
    cancellationReason: string | null;
  },
): Promise<StatusChangeResult> {
  const updated = await updateAppointment(tx, appointmentId, {
    ...next,
    statusChangedAt: new Date(),
  });
  if (!updated.ok) {
    return updated;
  }
  const { status, cancelledBy, cancellationReason } = current;
  const changed = changedFields(
    { status, cancelledBy, cancellationReason },
    {
      status: next.status,
      cancelledBy: next.cancelledBy,
      cancellationReason: next.cancellationReason,
    },
  );
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    patientId: current.patientId,
    before: changed!.before,
    after: changed!.after,
  });
  return { ok: true };
}

/** Moves the appointment to `status`, as the status rules allow at `now`. */
async function moveTo(
  actor: Actor,
  appointmentId: string,
  target: StatusAction,
  cancellation: { cancelledBy: Current["cancelledBy"]; cancellationReason: string | null },
  database: AnyDatabase | undefined,
): Promise<StatusChangeResult> {
  return withTenant(
    actor,
    async (tx) => {
      const current = await findForChange(tx, actor, appointmentId);
      if (!current) {
        return notFound;
      }
      const decided = decideStatusChange(current, target, current.actor, new Date());
      if (!decided.ok) {
        return decided;
      }
      return writeStatus(tx, actor, appointmentId, current, {
        status: decided.status,
        previousStatus: current.status,
        ...cancellation,
      });
    },
    database,
  );
}

/** Confirms, checks in, marks attended or marks a no-show. */
export async function changeAppointmentStatus(
  actor: Actor,
  input: StatusChangeInput,
  database?: AnyDatabase,
): Promise<StatusChangeResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, status } = parsed.data;
  const none = { cancelledBy: null, cancellationReason: null };
  return moveTo(actor, appointmentId, status, none, database);
}

/** Cancels, saying who cancelled and why: the time is free at once. */
export async function cancelAppointment(
  actor: Actor,
  input: CancellationInput,
  database?: AnyDatabase,
): Promise<StatusChangeResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = cancellationSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, cancelledBy, reason } = parsed.data;
  return moveTo(
    actor,
    appointmentId,
    "cancelled",
    { cancelledBy, cancellationReason: reason },
    database,
  );
}

/** Undoes the last status change: back to the previous status, once, the same day. */
export async function undoAppointmentStatus(
  actor: Actor,
  input: AppointmentIdInput,
  database?: AnyDatabase,
): Promise<StatusChangeResult> {
  if (!booksForSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentIdSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const current = await findForChange(tx, actor, appointmentId);
      if (!current) {
        return notFound;
      }
      const decided = decideUndo(current, current.actor, new Date());
      if (!decided.ok) {
        return decided;
      }
      return writeStatus(tx, actor, appointmentId, current, {
        status: decided.status,
        previousStatus: null,
        cancelledBy: null,
        cancellationReason: null,
      });
    },
    database,
  );
}
