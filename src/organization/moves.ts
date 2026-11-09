import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { moveRefusal } from "#/lib/proposals.ts";
import type { MoveRefusal } from "#/lib/proposals.ts";
import { appointmentDay, appointmentTime } from "#/lib/template-filling.ts";

import { rescheduleAppointment } from "#/organization/appointment-changes.ts";
import { asRange, findFreeTimes, meets } from "#/organization/availability.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { appointment, medicalService, practitioner } from "#/organization/schema.ts";
import { proposal } from "#/organization/whatsapp-schema.ts";

// A patient's own move of an appointment (docs/domain/assistant.md
// § Cancelling and moving): the free times of the same practitioner and
// medical service, at any office where the practitioner works, over the next
// 3 weeks, from availability, never an overbooking; allowed until the medical
// service's cutoff and once per appointment. The move itself is a proposal
// (`proposals.ts`) accepted through the app's own reschedule.

/** How far ahead the times offered reach (#151's defaults). */
const moveWindowMs = 21 * 24 * 60 * 60_000;

/** How many free times one call returns, so the model reads a short list. */
const slotsPerCall = 20;

/** A free time as the patient is offered it: its id is the start, the rest what they read. */
export interface Slot {
  slotId: string;
  date: string;
  time: string;
  office: string;
}

/** The appointment as a move reads it: its time, its practitioner's grid and its medical service's cutoff. */
function moveFacts(writer: Writer, appointmentId: string) {
  return writer
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      gridMinutes: practitioner.gridMinutes,
      cutoffHours: medicalService.rescheduleCutoffHours,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .where(eq(appointment.id, appointmentId))
    .get()!;
}

type MoveFacts = ReturnType<typeof moveFacts>;

/** The patient's own moves of the appointment: its accepted move proposals. */
function patientMoves(writer: Writer, appointmentId: string): number {
  const counted = writer
    .select({ moves: count() })
    .from(proposal)
    .where(
      and(
        eq(proposal.appointmentId, appointmentId),
        eq(proposal.kind, "move"),
        isNotNull(proposal.acceptedAt),
      ),
    )
    .get();
  return counted?.moves ?? 0;
}

function refusalOf(writer: Writer, moving: MoveFacts, now: number): MoveRefusal | null {
  return moveRefusal({ ...moving, patientMoves: patientMoves(writer, moving.id) }, now);
}

/** Whether the patient's other active appointments leave `start` free for them. */
function patientBusyAt(writer: Writer, moving: MoveFacts, window: { start: Date; end: Date }) {
  const busy = writer
    .select({ startsAt: appointment.startsAt, endsAt: appointment.endsAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.patientId, moving.patientId),
        ne(appointment.id, moving.id),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        meets(appointment, window),
      ),
    )
    .all()
    .map(asRange);
  return (start: Date, end: Date) => busy.some((range) => range.start < end && start < range.end);
}

/**
 * Every free time the appointment can move to from `now`, of its duration,
 * but for its own start and a time its patient is busy at, earliest first,
 * each with its local start (`YYYY-MM-DDTHH:MM`) in its office's zone.
 */
function allSlots(writer: Writer, moving: MoveFacts, now: number) {
  const durationMs = moving.endsAt - moving.startsAt;
  const window = { start: new Date(now), end: new Date(now + moveWindowMs) };
  const { free, schedules } = findFreeTimes(
    writer,
    { id: moving.practitionerId, gridMinutes: moving.gridMinutes },
    { window, durationMinutes: durationMs / 60_000, excludeAppointmentId: moving.id },
  );
  const rooms = new Map(schedules.map((row) => [row.roomId, row]));
  const patientBusy = patientBusyAt(writer, moving, {
    start: window.start,
    end: new Date(+window.end + durationMs),
  });
  return free
    .filter(({ start }) => +start !== moving.startsAt)
    .filter(({ start }) => !patientBusy(start, new Date(+start + durationMs)))
    .map(({ start, roomId }) => {
      const where = rooms.get(roomId)!;
      const slot: Slot = {
        slotId: start.toISOString(),
        date: appointmentDay(start, where.timeZone),
        time: appointmentTime(start, where.timeZone),
        office: where.officeName,
      };
      return { slot, localStart: format(start, "yyyy-MM-dd'T'HH:mm", { in: tz(where.timeZone) }) };
    });
}

/** The free times the patient may move the appointment to now, or why a rule refuses the move. */
function allowedSlots(writer: Writer, appointmentId: string) {
  const now = Date.now();
  const moving = moveFacts(writer, appointmentId);
  const refusal = refusalOf(writer, moving, now);
  return refusal
    ? ({ ok: false, reason: refusal } as const)
    : ({ ok: true, slots: allSlots(writer, moving, now) } as const);
}

/**
 * The free times find_free_times offers for the appointment, from the local
 * date or start `from` when given, at most `slotsPerCall`; or why the patient
 * may not move it.
 */
export function freeTimesFor(
  writer: Writer,
  appointmentId: string,
  from: string | undefined,
): { ok: true; slots: Slot[]; more: boolean } | { ok: false; reason: MoveRefusal } {
  const allowed = allowedSlots(writer, appointmentId);
  if (!allowed.ok) {
    return allowed;
  }
  // A date reads as the start of its day: "2099-01-19" sorts before "2099-01-19T09:00".
  const slots = allowed.slots
    .filter((one) => from === undefined || one.localStart >= from)
    .map((one) => one.slot);
  return { ok: true, slots: slots.slice(0, slotsPerCall), more: slots.length > slotsPerCall };
}

/** The free time `slotId` names, while it is one the appointment can move to now. */
export function slotFor(writer: Writer, appointmentId: string, slotId: string) {
  const allowed = allowedSlots(writer, appointmentId);
  if (!allowed.ok) {
    return allowed;
  }
  const slot = allowed.slots.find((one) => one.slot.slotId === slotId)?.slot;
  return slot ? ({ ok: true, slot } as const) : ({ ok: false, reason: "notFree" } as const);
}

/** A refusal as the patient hears it: a start no longer free is a time taken. */
function asTaken<T extends { ok: false; reason: string }>(refusal: T) {
  return refusal.reason === "notFree" ? ({ ok: false, reason: "timeTaken" } as const) : refusal;
}

/**
 * Moves the appointment to the free time `stated`, as the patient's own move,
 * while it is still free and reads as they were told (date, time and
 * office): the app's reschedule then checks it again in the same
 * transaction. Their other appointments that day do not hold it, since they
 * picked the time.
 */
export function movePatientAppointment(
  database: Database,
  acting: Acting,
  move: { appointmentId: string; stated: Slot },
) {
  const { appointmentId, stated } = move;
  const found = slotFor(database, appointmentId, stated.slotId);
  if (!found.ok) {
    return asTaken(found);
  }
  if (JSON.stringify(found.slot) !== JSON.stringify(stated)) {
    return { ok: false, reason: "timeTaken" } as const;
  }
  const moving = moveFacts(database, appointmentId);
  const moved = rescheduleAppointment(
    database,
    acting,
    {
      appointmentId,
      start: new Date(stated.slotId),
      durationMinutes: (moving.endsAt - moving.startsAt) / 60_000,
      confirmWarnings: true,
    },
    { byPatient: true },
  );
  return moved.ok ? ({ ok: true } as const) : asTaken(moved);
}
