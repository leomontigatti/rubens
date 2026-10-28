import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import { actsForEveryone } from "#/lib/access.ts";
import type { Role } from "#/lib/access.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";

// Moving an appointment through its statuses (docs/domain/appointments.md §
// Statuses): which change is allowed from which status, to whom, and when, and
// the same-day undo. Pure: the services read the rows and the clock.

/** The statuses staff move an appointment to, in the order they are offered. */
const statusActions = [
  "confirmed",
  "checkedIn",
  "attended",
  "noShow",
  "cancelled",
] as const satisfies readonly AppointmentStatus[];

export type StatusAction = (typeof statusActions)[number];

/** Who acts: their roles, and whether the appointment is with themselves. */
export interface StatusActor {
  roles: readonly Role[];
  own: boolean;
}

export type StatusChange =
  | { ok: true; status: StatusAction }
  | { ok: false; reason: "notAllowed" | "forbidden" | "beforeStart" };

export type UndoDecision =
  | { ok: true; status: AppointmentStatus }
  | { ok: false; reason: "nothingToUndo" | "forbidden" | "tooLate" };

const sources: Record<StatusAction, readonly AppointmentStatus[]> = {
  confirmed: ["booked"],
  checkedIn: ["booked", "confirmed"],
  // From booked or confirmed it checks in and attends in one action.
  attended: ["booked", "confirmed", "checkedIn"],
  noShow: ["booked", "confirmed"],
  cancelled: ["booked", "confirmed"],
};

function isOwnPractitioner(actor: StatusActor): boolean {
  return actor.roles.includes("practitioner") && actor.own;
}

/** Whether the actor's roles allow moving an appointment to `status`. */
function mayMake(status: AppointmentStatus, actor: StatusActor): boolean {
  if (status === "checkedIn" || status === "noShow") {
    return actsForEveryone(actor);
  }
  return actsForEveryone(actor) || isOwnPractitioner(actor);
}

/** Whether the appointment, starting at `start`, may go from `status` to `target` at `now`. */
export function decideStatusChange(
  appointment: { status: AppointmentStatus; start: Date },
  target: StatusAction,
  actor: StatusActor,
  now: Date,
): StatusChange {
  if (!sources[target].includes(appointment.status)) {
    return { ok: false, reason: "notAllowed" };
  }
  if (!mayMake(target, actor)) {
    return { ok: false, reason: "forbidden" };
  }
  if (target === "noShow" && now < appointment.start) {
    return { ok: false, reason: "beforeStart" };
  }
  return { ok: true, status: target };
}

/** The changes the actor may make to the appointment at `now`. */
export function statusActionsFor(
  appointment: { status: AppointmentStatus; start: Date },
  actor: StatusActor,
  now: Date,
): StatusAction[] {
  return statusActions.filter((target) => decideStatusChange(appointment, target, actor, now).ok);
}

function localDate(instant: Date, timeZone: string): string {
  return format(instant, "yyyy-MM-dd", { in: tz(timeZone) });
}

/**
 * Whether the last status change can be undone at `now`: once, on the local
 * day of the change in the office's zone, by a role allowed to make it. An
 * undo clears the previous status, so a second one finds nothing to undo.
 */
export function decideUndo(
  appointment: {
    status: AppointmentStatus;
    previousStatus: AppointmentStatus | null;
    statusChangedAt: Date;
    timeZone: string;
  },
  actor: StatusActor,
  now: Date,
): UndoDecision {
  const { previousStatus, timeZone } = appointment;
  if (previousStatus === null) {
    return { ok: false, reason: "nothingToUndo" };
  }
  if (!mayMake(appointment.status, actor)) {
    return { ok: false, reason: "forbidden" };
  }
  if (localDate(appointment.statusChangedAt, timeZone) !== localDate(now, timeZone)) {
    return { ok: false, reason: "tooLate" };
  }
  return { ok: true, status: previousStatus };
}

/** Each status as the user reads it (GLOSSARY.md). */
export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  booked: "Reservado",
  confirmed: "Confirmado",
  checkedIn: "En sala",
  attended: "Atendido",
  noShow: "Ausente",
  cancelled: "Cancelado",
};

/** The button that makes each change. */
export const statusActionLabels: Record<StatusAction, string> = {
  confirmed: "Confirmar",
  checkedIn: "Marcar en sala",
  attended: "Marcar atendido",
  noShow: "Marcar ausente",
  cancelled: "Cancelar turno",
};

/** Who cancelled, as the user reads it. */
export const cancellerLabels: Record<"patient" | "business", string> = {
  patient: "El paciente",
  business: "El consultorio",
};

/** Who cancelled and why, as one line; `null` for an appointment not cancelled. */
export function cancellationText(appointment: {
  cancelledBy: "patient" | "business" | null;
  cancellationReason: string | null;
}): string | null {
  if (!appointment.cancelledBy) {
    return null;
  }
  const who = `Canceló: ${cancellerLabels[appointment.cancelledBy]}`;
  return appointment.cancellationReason ? `${who} (${appointment.cancellationReason})` : who;
}
