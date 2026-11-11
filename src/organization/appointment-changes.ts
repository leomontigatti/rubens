import { and, asc, eq, inArray, ne, or } from "drizzle-orm";

import { actsForEveryone } from "#/lib/access.ts";
import { decideStatusChange, decideUndo } from "#/lib/appointment-statuses.ts";
import type { StatusAction, StatusActor } from "#/lib/appointment-statuses.ts";
import { changedFields } from "#/lib/audit-fields.ts";
import {
  activeAppointmentStatuses,
  appointmentIdSchema,
  appointmentUpdateSchema,
  cancellationSchema,
  isActiveStatus,
  rescheduleSchema,
  statusChangeSchema,
} from "#/lib/appointments.ts";
import type {
  AppointmentIdInput,
  AppointmentStatus,
  AppointmentUpdate,
  CancellationInput,
  RescheduleInput,
  StatusChangeInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";

import { checkRoomSpace, placeAtTime } from "#/organization/appointment-placement.ts";
import type { PlacementRefusal, RoomRefusal } from "#/organization/appointment-placement.ts";
import {
  findBookablePractitioner,
  selectDayAppointments,
  toDayAppointment,
} from "#/organization/appointments.ts";
import type { DayAppointment } from "#/organization/appointments.ts";
import { recordAudit } from "#/organization/audit.ts";
import { dropChangeMessages, queueChangeMessage } from "#/organization/change-messages.ts";
import { asRange, meets } from "#/organization/availability.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { requeueBefore, requeueOnStatus } from "#/organization/template-messages.ts";
import { findPatient } from "#/organization/patients.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import { appointment, office, room } from "#/organization/schema.ts";

// Changing an appointment that exists (docs/domain/appointments.md): reading it
// on pages of its own, saving its reception note and room, rescheduling it to
// a new time, moving it through its statuses, cancelling it and the same-day
// undo. Every staff role may act (the object's requirement); on whose
// appointments is decided here, as for booking. Each change reads the
// appointment, checks and writes in one synchronous transaction (ADR-0008),
// so the overlap and capacity rules hold until the write, and audits it about
// the appointment's patient.

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

type PractitionerRefusal = { ok: false; reason: "forbidden" | "notFound" | "practitionerInactive" };

export type AppointmentRecord =
  | {
      ok: true;
      appointment: DayAppointment;
      /** Its office's zone, and the rooms it can move to: the active ones and its own. */
      office: { timeZone: string; rooms: { id: string; name: string }[] };
    }
  | { ok: false; reason: "invalidInput" | "notFound" };

export type AppointmentUpdateResult =
  | { ok: true }
  | { ok: false; reason: "invalidInput" }
  | PractitionerRefusal
  | RoomRefusal
  | { ok: false; reason: "otherOffice" };

export type RescheduleResult =
  | { ok: true }
  | { ok: false; reason: "invalidInput" | "patientInactive" }
  | PractitionerRefusal
  | PlacementRefusal<"freeStart">
  | PlacementRefusal<"overbooking">;

export type StatusChangeResult =
  | { ok: true }
  | RoomRefusal
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

/** The appointment as a change reads it, with its office. */
function findPlaced(writer: Writer, appointmentId: string) {
  const found = writer
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      roomId: appointment.roomId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      overbooking: appointment.overbooking,
      status: appointment.status,
      previousStatus: appointment.previousStatus,
      statusChangedAt: appointment.statusChangedAt,
      cancelledBy: appointment.cancelledBy,
      cancellationReason: appointment.cancellationReason,
      receptionNote: appointment.receptionNote,
      officeId: office.id,
      timeZone: office.timeZone,
    })
    .from(appointment)
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(appointment.id, appointmentId))
    .get();
  if (!found) {
    return undefined;
  }
  const { startsAt, endsAt, statusChangedAt, ...rest } = found;
  return {
    ...rest,
    during: asRange({ startsAt, endsAt }),
    statusChangedAt: new Date(statusChangedAt),
  };
}

type Placed = NonNullable<ReturnType<typeof findPlaced>>;

function officeOf(writer: Writer, roomId: string) {
  return writer.select({ officeId: room.officeId }).from(room).where(eq(room.id, roomId)).get()
    ?.officeId;
}

/** The appointment, when `acting` sees it in full; another practitioner's is not found. */
export function getAppointment(
  writer: Writer,
  acting: Acting,
  input: AppointmentIdInput,
): AppointmentRecord {
  const parsed = appointmentIdSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const booked = selectDayAppointments(writer)
    .where(eq(appointment.id, parsed.data.appointmentId))
    .get();
  const own = booked?.practitionerUserId === acting.userId;
  if (!booked || !(actsForEveryone(acting) || own)) {
    return notFound;
  }
  const rooms = writer
    .select({ id: room.id, name: room.name })
    .from(room)
    .where(
      and(
        eq(room.officeId, booked.officeId),
        or(eq(room.active, true), eq(room.id, booked.roomId)),
      ),
    )
    .orderBy(asc(room.name))
    .all();
  return {
    ok: true,
    appointment: toDayAppointment(booked, { roles: acting.roles, own }, new Date()),
    office: { timeZone: booked.timeZone, rooms },
  };
}

/** Moves the appointment to `roomId`, another of its office at the same time, and audits it. */
function moveToRoom(
  writer: Writer,
  acting: Acting,
  placed: Placed,
  roomId: string,
): { ok: true } | RoomRefusal | { ok: false; reason: "otherOffice" } {
  const space = checkRoomSpace(writer, roomId, placed.practitionerId, placed.during);
  if (!space.ok) {
    return space;
  }
  if (space.officeId !== placed.officeId) {
    return { ok: false, reason: "otherOffice" };
  }
  writer.update(appointment).set({ roomId }).where(eq(appointment.id, placed.id)).run();
  recordAudit(writer, acting.userId, {
    action: "update",
    entityType: "appointment",
    entityId: placed.id,
    patientId: placed.patientId,
    before: { roomId: placed.roomId },
    after: { roomId },
  });
  return { ok: true };
}

/**
 * Saves the appointment's reception note, and moves it to `roomId` when
 * given. A new room, at the same time, is for an active appointment, and
 * needs space; when it is refused, the note is not saved either.
 */
export function updateAppointment(
  database: Database,
  acting: Acting,
  input: AppointmentUpdate,
): AppointmentUpdateResult {
  const parsed = appointmentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, roomId, receptionNote } = parsed.data;
  return database.transaction((tx): AppointmentUpdateResult => {
    const placed = findPlaced(tx, appointmentId);
    if (!placed) {
      return notFound;
    }
    const found = findBookablePractitioner(tx, acting, placed.practitionerId);
    if (!found.ok) {
      return found;
    }
    if (roomId !== undefined && roomId !== placed.roomId) {
      if (!isActiveStatus(placed.status)) {
        return notFound;
      }
      const moved = moveToRoom(tx, acting, placed, roomId);
      if (!moved.ok) {
        return moved;
      }
    }
    const changed = changedFields({ receptionNote: placed.receptionNote }, { receptionNote });
    if (changed) {
      tx.update(appointment).set({ receptionNote }).where(eq(appointment.id, appointmentId)).run();
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "appointment",
        entityId: appointmentId,
        patientId: placed.patientId,
        ...changed,
      });
    }
    return { ok: true };
  });
}

const reschedulable: readonly AppointmentStatus[] = ["booked", "confirmed"];

/**
 * Moves a booked or confirmed appointment to a new time, and with it its room
 * (docs/domain/appointments.md § Rescheduling), under the checks of booking: a
 * free start of the practitioner's, which takes its schedule's room and may be
 * in another office, or an overbooking. The appointment's own time counts as
 * free. The audit entry keeps the previous values. The patient is told of a
 * move the organization made, not of one `byPatient`, which they asked for
 * and which drops the change messages not sent yet.
 */
export function rescheduleAppointment(
  database: Database,
  acting: Acting,
  input: RescheduleInput & WarningConfirmation,
  { byPatient = false } = {},
): RescheduleResult {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, start, durationMinutes, overbooking, roomId } = parsed.data;
  const span = { start, end: new Date(+start + durationMinutes * 60_000) };
  return database.transaction((tx): RescheduleResult => {
    const placed = findPlaced(tx, appointmentId);
    if (!placed || !reschedulable.includes(placed.status)) {
      return notFound;
    }
    const found = findBookablePractitioner(tx, acting, placed.practitionerId);
    if (!found.ok) {
      return found;
    }
    if (!findPatient(tx, placed.patientId)?.active) {
      return { ok: false, reason: "patientInactive" };
    }
    const where = placeAtTime(
      tx,
      found,
      placed.patientId,
      overbooking
        ? { kind: "overbooking", span, pickedRoomId: roomId }
        : { kind: "freeStart", span },
      input.confirmWarnings === true,
      placed.id,
    );
    if (!where.ok) {
      return where;
    }
    const values = { startsAt: +span.start, endsAt: +span.end, roomId: where.roomId, overbooking };
    tx.update(appointment).set(values).where(eq(appointment.id, placed.id)).run();
    requeueBefore(tx, placed.id);
    if (byPatient) {
      dropChangeMessages(tx, placed.id);
    } else if (
      +span.start !== +placed.during.start ||
      officeOf(tx, where.roomId) !== placed.officeId
    ) {
      queueChangeMessage(tx, placed.id, "appointmentMoved");
    }
    const changed = changedFields(
      { ...placed.during, roomId: placed.roomId, overbooking: placed.overbooking },
      { ...span, roomId: where.roomId, overbooking },
    );
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "appointment",
        entityId: placed.id,
        patientId: placed.patientId,
        ...changed,
      });
    }
    return { ok: true };
  });
}

/** What a status change leaves on the appointment. */
interface NextStatus {
  status: AppointmentStatus;
  previousStatus: AppointmentStatus | null;
  cancelledBy: Placed["cancelledBy"];
  cancellationReason: string | null;
}

/**
 * Whether another of the practitioner's active appointments holds the time of
 * `placed`: an overbooking on either side holds none against the other.
 */
function practitionerTimeTaken(writer: Writer, placed: Placed): boolean {
  if (placed.overbooking) {
    return false;
  }
  const other = writer
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, placed.practitionerId),
        ne(appointment.id, placed.id),
        eq(appointment.overbooking, false),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment, placed.during),
      ),
    )
    .get();
  return other !== undefined;
}

/**
 * Moves the appointment to the status the status rules allowed, and audits
 * it. A change back to holding time needs its room to have space still, and
 * the practitioner's time to be free.
 */
function setStatus(
  writer: Writer,
  acting: Acting,
  placed: Placed,
  next: NextStatus,
): StatusChangeResult {
  if (!isActiveStatus(placed.status) && isActiveStatus(next.status)) {
    const space = checkRoomSpace(writer, placed.roomId, placed.practitionerId, placed.during);
    if (!space.ok) {
      return space;
    }
    if (practitionerTimeTaken(writer, placed)) {
      return { ok: false, reason: "timeTaken" };
    }
  }
  writer
    .update(appointment)
    .set({ ...next, statusChangedAt: Date.now() })
    .where(eq(appointment.id, placed.id))
    .run();
  requeueOnStatus(writer, placed, next.status);
  if (next.status === "cancelled" && next.cancelledBy === "business") {
    queueChangeMessage(writer, placed.id, "appointmentCancelled");
  }
  const { status, cancelledBy, cancellationReason } = placed;
  const changed = changedFields(
    { status, cancelledBy, cancellationReason },
    {
      status: next.status,
      cancelledBy: next.cancelledBy,
      cancellationReason: next.cancellationReason,
    },
  );
  recordAudit(writer, acting.userId, {
    action: "update",
    entityType: "appointment",
    entityId: placed.id,
    patientId: placed.patientId,
    before: changed!.before,
    after: changed!.after,
  });
  return { ok: true };
}

/** `acting` as the status rules see them, about the appointment's practitioner. */
function statusActorOf(writer: Writer, acting: Acting, placed: Placed): StatusActor {
  const found = findPractitioner(writer, acting, placed.practitionerId);
  return { roles: acting.roles, own: found?.canEdit === true };
}

/** Moves the appointment to `target`, as the status rules allow now. */
function moveTo(
  database: Database,
  acting: Acting,
  appointmentId: string,
  target: StatusAction,
  cancellation: Pick<NextStatus, "cancelledBy" | "cancellationReason">,
): StatusChangeResult {
  return database.transaction((tx): StatusChangeResult => {
    const placed = findPlaced(tx, appointmentId);
    if (!placed) {
      return notFound;
    }
    const decided = decideStatusChange(
      { status: placed.status, start: placed.during.start },
      target,
      statusActorOf(tx, acting, placed),
      new Date(),
    );
    if (!decided.ok) {
      return decided;
    }
    return setStatus(tx, acting, placed, {
      status: decided.status,
      previousStatus: placed.status,
      ...cancellation,
    });
  });
}

/** Confirms, checks in, marks attended or marks a no-show. */
export function changeAppointmentStatus(
  database: Database,
  acting: Acting,
  input: StatusChangeInput,
): StatusChangeResult {
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, status } = parsed.data;
  return moveTo(database, acting, appointmentId, status, {
    cancelledBy: null,
    cancellationReason: null,
  });
}

/** Cancels, saying who cancelled and why: the time is free at once. */
export function cancelAppointment(
  database: Database,
  acting: Acting,
  input: CancellationInput,
): StatusChangeResult {
  const parsed = cancellationSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentId, cancelledBy, reason } = parsed.data;
  return moveTo(database, acting, appointmentId, "cancelled", {
    cancelledBy,
    cancellationReason: reason,
  });
}

/** Undoes the last status change: back to the previous status, once, the same day. */
export function undoAppointmentStatus(
  database: Database,
  acting: Acting,
  input: AppointmentIdInput,
): StatusChangeResult {
  const parsed = appointmentIdSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx): StatusChangeResult => {
    const placed = findPlaced(tx, parsed.data.appointmentId);
    if (!placed) {
      return notFound;
    }
    const decided = decideUndo(placed, statusActorOf(tx, acting, placed), new Date());
    if (!decided.ok) {
      return decided;
    }
    return setStatus(tx, acting, placed, {
      status: decided.status,
      previousStatus: null,
      cancelledBy: null,
      cancellationReason: null,
    });
  });
}
