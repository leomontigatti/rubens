import { and, eq } from "drizzle-orm";

import { appointment, medicalService, office, patient, room } from "#/db/schema/index.ts";
import type { Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { isActiveStatus } from "#/lib/appointments.ts";

import {
  checkRoomSpace,
  resolveTime,
  writeMovedRow,
  writeNewRow,
  writeRoomChange,
  writeStatusRow,
} from "#/server/appointment-placement-steps.ts";
import type {
  BookablePractitioner,
  FreeStartPlacement,
  NextStatus,
  OverbookingPlacement,
  RoomRefusal,
  TimeTaken,
  WarningRefusal,
} from "#/server/appointment-placement-steps.ts";
import { changedFields, recordAudit } from "#/server/audit.ts";

export type { RoomOccupant } from "#/server/appointment-placement-steps.ts";

// Appointment placement: every write that decides when and where an appointment
// holds time, or whether it holds time at all. A caller says what it wants as a
// placement and gets back success or a structured refusal; it owns its role
// gate, its parsing, `withTenant` and finding the practitioner, and nothing here
// opens a transaction.
//
// The sequence, whichever the caller:
//
// 1. Lock the appointment row, when there is one, and read it after the lock.
//    A new appointment has none: check its medical service and patient instead.
// 2. Resolve the room and take its row lock when the room's space is at stake.
//    Always in this order, appointment row then room row, so two changes never
//    wait on each other. A free start takes no room lock: see `checkRoomSpace`.
// 3. Check what the placement needs: room space, its office, working time, then
//    the patient's warnings.
// 4. Write in a savepoint. The exclusion constraints stay the arbiter (ADR-0003):
//    the write reports which one fired, and the transaction survives to read why.
// 5. Recover a lost race into the refusal for that placement and constraint.
// 6. Audit the write in the same transaction.

type SameTimePlacement = { kind: "sameTime"; roomId: string };

/** A placement at a new time, which any new appointment needs: it has no time to keep. */
export type NewPlacement = FreeStartPlacement | OverbookingPlacement;

/** A placement: what the caller wants of the appointment's time and room. */
export type Placement = NewPlacement | SameTimePlacement;

/** What the new appointment is for. */
interface Visit {
  patientId: string;
  medicalServiceId: string;
  receptionNote: string | null;
}

type VisitRefusal = {
  ok: false;
  reason: "notFound" | "medicalServiceInactive" | "patientInactive";
};

interface RefusalsByKind {
  freeStart: VisitRefusal | WarningRefusal | { ok: false; reason: "notFree" } | TimeTaken;
  overbooking:
    | VisitRefusal
    | WarningRefusal
    | RoomRefusal
    | { ok: false; reason: "roomRequired" | "timeOff" | "closed" };
  sameTime: RoomRefusal | { ok: false; reason: "otherOffice" };
  status: RoomRefusal | { ok: false; reason: "timeTaken" };
}

/** Why a placement of that kind was refused, so a screen's copy map covers each. */
export type PlacementRefusal<Kind extends keyof RefusalsByKind = keyof RefusalsByKind> =
  RefusalsByKind[Kind];

/** Why a move to a new time was refused: all but what only a new appointment can hit. */
type NewTimeMoveRefusal = Exclude<PlacementRefusal<NewPlacement["kind"]>, VisitRefusal>;

interface Confirmation {
  confirmWarnings: boolean;
}

/**
 * Locks the appointment row for the rest of the transaction, so changes of one
 * appointment run one after the other, and reads it after the lock, as a change
 * that held the lock first left it. Taken before any room lock.
 */
export async function lockPlaced(tx: Transaction, appointmentId: string) {
  await tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(eq(appointment.id, appointmentId))
    .for("update");
  const [placed] = await tx
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      roomId: appointment.roomId,
      during: appointment.during,
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
    .where(eq(appointment.id, appointmentId));
  return placed;
}

type Placed = NonNullable<Awaited<ReturnType<typeof lockPlaced>>>;

/** Why the medical service, one of the practitioner's, or the patient cannot be booked; `null` when both can. */
async function checkServiceAndPatient(
  tx: Transaction,
  practitionerId: string,
  { medicalServiceId, patientId }: Visit,
): Promise<VisitRefusal | null> {
  const [service] = await tx
    .select({ active: medicalService.active })
    .from(medicalService)
    .where(
      and(
        eq(medicalService.id, medicalServiceId),
        eq(medicalService.practitionerId, practitionerId),
      ),
    );
  const [patientRow] = await tx
    .select({ active: patient.active })
    .from(patient)
    .where(eq(patient.id, patientId));
  if (!service || !patientRow) {
    return { ok: false, reason: "notFound" };
  }
  if (!service.active) {
    return { ok: false, reason: "medicalServiceInactive" };
  }
  return patientRow.active ? null : { ok: false, reason: "patientInactive" };
}

/**
 * Places a new appointment for an authorised, active practitioner. The patient's
 * other appointments that day warn until `confirmWarnings`.
 */
export async function placeNew(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  visit: Visit,
  placement: FreeStartPlacement,
  confirmation: Confirmation,
): Promise<{ ok: true; id: string } | PlacementRefusal<"freeStart">>;
export async function placeNew(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  visit: Visit,
  placement: OverbookingPlacement,
  confirmation: Confirmation,
): Promise<{ ok: true; id: string } | PlacementRefusal<"overbooking">>;
export async function placeNew(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  visit: Visit,
  placement: NewPlacement,
  { confirmWarnings }: Confirmation,
): Promise<{ ok: true; id: string } | PlacementRefusal<NewPlacement["kind"]>> {
  const refused = await checkServiceAndPatient(tx, practitioner.id, visit);
  if (refused) {
    return refused;
  }
  const { span } = placement;
  const { patientId, medicalServiceId, receptionNote } = visit;
  const where = await resolveTime(
    tx,
    practitioner,
    patientId,
    placement,
    confirmWarnings,
    undefined,
  );
  if (!where.ok) {
    return where;
  }

  const fields = {
    patientId,
    practitionerId: practitioner.id,
    medicalServiceId,
    roomId: where.roomId,
    ...(placement.kind === "overbooking" ? { overbooking: true } : {}),
    receptionNote,
  };
  const written = await writeNewRow(
    tx,
    practitioner,
    { ...fields, during: span, organizationId: actor.organizationId, createdBy: actor.userId },
    where.timeZone,
  );
  if (!written.ok) {
    return written;
  }
  await recordAudit(tx, actor, {
    action: "create",
    entityType: "appointment",
    entityId: written.id,
    patientId,
    before: null,
    after: {
      ...fields,
      start: span.start.toISOString(),
      end: span.end.toISOString(),
      status: "booked",
    },
  });
  return written;
}

async function moveToRoom(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  placed: Placed,
  roomId: string,
): Promise<{ ok: true } | PlacementRefusal<"sameTime">> {
  if (roomId === placed.roomId) {
    return { ok: true };
  }
  const space = await checkRoomSpace(tx, roomId, practitioner.id, placed.during);
  if (!space.ok) {
    return space;
  }
  if (space.officeId !== placed.officeId) {
    return { ok: false, reason: "otherOffice" };
  }
  const written = await writeRoomChange(tx, placed, roomId);
  if (!written.ok) {
    return written;
  }
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "appointment",
    entityId: placed.id,
    patientId: placed.patientId,
    before: { roomId: placed.roomId },
    after: { roomId },
  });
  return { ok: true };
}

async function moveToTime(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  placed: Placed,
  placement: NewPlacement,
  confirmWarnings: boolean,
): Promise<{ ok: true } | NewTimeMoveRefusal> {
  const { span, kind } = placement;
  const { id, patientId } = placed;
  const where = await resolveTime(tx, practitioner, patientId, placement, confirmWarnings, id);
  if (!where.ok) {
    return where;
  }
  const { roomId, timeZone } = where;
  const overbooking = kind === "overbooking";
  const values = { during: span, roomId, overbooking };
  const written = await writeMovedRow(tx, practitioner, id, values, timeZone);
  if (!written.ok) {
    return written;
  }
  const changed = changedFields(
    { ...placed.during, roomId: placed.roomId, overbooking: placed.overbooking },
    { ...span, roomId, overbooking },
  );
  if (changed) {
    await recordAudit(tx, actor, {
      action: "update",
      entityType: "appointment",
      entityId: id,
      patientId,
      ...changed,
    });
  }
  return { ok: true };
}

/**
 * Moves a locked appointment where the placement says, excluding it from its own
 * busy time. Keeping the room it already has at the same time is a success with
 * no write and no audit entry. Only a new time warns about the patient's other
 * appointments that day, until `confirmWarnings`.
 */
export async function movePlaced(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  placed: Placed,
  placement: SameTimePlacement,
  confirmation: Confirmation,
): Promise<{ ok: true } | PlacementRefusal<"sameTime">>;
export async function movePlaced(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  placed: Placed,
  placement: NewPlacement,
  confirmation: Confirmation,
): Promise<{ ok: true } | NewTimeMoveRefusal>;
export async function movePlaced(
  tx: Transaction,
  actor: Actor,
  practitioner: BookablePractitioner,
  placed: Placed,
  placement: Placement,
  { confirmWarnings }: Confirmation,
): Promise<{ ok: true } | PlacementRefusal<"sameTime"> | NewTimeMoveRefusal> {
  return placement.kind === "sameTime"
    ? moveToRoom(tx, actor, practitioner, placed, placement.roomId)
    : moveToTime(tx, actor, practitioner, placed, placement, confirmWarnings);
}

/**
 * Moves a locked appointment to the status the status rules allowed, and audits
 * it. A change back to holding time needs its room to have space still.
 */
export async function setPlacedStatus(
  tx: Transaction,
  actor: Actor,
  placed: Placed,
  next: NextStatus,
): Promise<{ ok: true } | PlacementRefusal<"status">> {
  if (!isActiveStatus(placed.status) && isActiveStatus(next.status)) {
    const space = await checkRoomSpace(tx, placed.roomId, placed.practitionerId, placed.during);
    if (!space.ok) {
      return space;
    }
  }
  const written = await writeStatusRow(tx, placed, next);
  if (!written.ok) {
    return written;
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
  await recordAudit(tx, actor, {
    action: "update",
    entityType: "appointment",
    entityId: placed.id,
    patientId: placed.patientId,
    before: changed!.before,
    after: changed!.after,
  });
  return { ok: true };
}
