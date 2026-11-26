import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { assistantToolSchemas } from "#/lib/assistant.ts";
import { formatDay, formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { present } from "#/lib/present.ts";

import { findFreeTimes } from "#/organization/availability.ts";
import type { Database } from "#/organization/database.ts";
import { listSchedulePractitioners } from "#/organization/practitioners.ts";
import { medicalService, practitioner } from "#/organization/schema.ts";

// The free times the patient assistant offers for a new appointment
// (docs/domain/assistant.md § For patients): from the same availability staff
// see, on each practitioner's grid, for the medical service's duration, never
// an overbooking, from now to 60 days ahead. Moving an appointment has its own
// (`moves.ts`).

/** How far ahead the times offered reach, with no setting. */
const bookingWindowMs = 60 * 24 * 60 * 60_000;

/** How many times one call returns: the few nearest to what the patient prefers. */
const timesPerCall = 5;

/**
 * The medical service rows `which` picks, by name and practitioner, of the
 * practitioners who practise: those the schedules screen lists. Patients can
 * book those `bookable` keeps.
 */
export function offering(database: Database, which: SQL | undefined) {
  const practising = new Set(
    listSchedulePractitioners(database).practitioners.map((one) => one.id),
  );
  return database
    .select({
      id: medicalService.id,
      name: medicalService.name,
      active: medicalService.active,
      whatsappBooking: medicalService.whatsappBooking,
      durationMinutes: medicalService.durationMinutes,
      practitionerId: practitioner.id,
      practitioner: practitioner.displayName,
      gridMinutes: practitioner.gridMinutes,
    })
    .from(medicalService)
    .innerJoin(practitioner, eq(practitioner.id, medicalService.practitionerId))
    .where(which)
    .orderBy(asc(medicalService.name), asc(practitioner.displayName))
    .all()
    .filter((row) => practising.has(row.practitionerId));
}

type Offering = ReturnType<typeof offering>[number];

/** A medical service patients can book by WhatsApp: active, with the switch on. */
export function bookable(row: Offering) {
  return row.active && row.whatsappBooking;
}

/** The free times of the medical service `row` from `now` over the window, each in its room. */
function freeTimesOf(database: Database, row: Offering, now: number) {
  const window = { start: new Date(now), end: new Date(now + bookingWindowMs) };
  const { free, schedules } = findFreeTimes(
    database,
    { id: row.practitionerId, gridMinutes: row.gridMinutes },
    { window, durationMinutes: row.durationMinutes },
  );
  const rooms = new Map(schedules.map((one) => [one.roomId, one.roomName]));
  return free.map(({ start, roomId }) => ({
    start,
    slotId: `${row.id}@${start.toISOString()}`,
    roomId,
    room: present(rooms.get(roomId), "A free time is in the room of one of its schedules"),
    date: formatDay(start, practiceTimeZone),
    time: formatTime(start, practiceTimeZone),
  }));
}

/**
 * What find_booking_times returns: the few free times nearest from the local
 * date or start `from` the patient prefers, of the named practitioner or
 * across those who offer the medical service, each with its practitioner and
 * room; or why the medical service has none.
 */
export function findBookingTimes(database: Database, args: unknown) {
  const parsed = assistantToolSchemas.find_booking_times.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const { medicalService: name, practitioner: practitionerName, from } = parsed.data;
  const rows = offering(
    database,
    and(
      eq(medicalService.name, name),
      practitionerName === undefined ? undefined : eq(practitioner.displayName, practitionerName),
    ),
  );
  if (rows.length === 0) {
    return { ok: false, reason: "notFound" } as const;
  }
  const active = rows.filter((row) => row.active);
  if (active.length === 0) {
    return { ok: false, reason: "archived" } as const;
  }
  const offered = active.filter(bookable);
  if (offered.length === 0) {
    return { ok: false, reason: "whatsappBookingOff" } as const;
  }
  const now = Date.now();
  // A date reads as the start of its day: "2099-01-19" sorts before "2099-01-19T09:00".
  const times = offered
    .flatMap((row) =>
      freeTimesOf(database, row, now).map(({ start, slotId, room, date, time }) => ({
        start,
        localStart: format(start, "yyyy-MM-dd'T'HH:mm", { in: tz(practiceTimeZone) }),
        slot: { slotId, practitioner: row.practitioner, room, date, time },
      })),
    )
    .filter((one) => one.localStart >= from)
    .sort((a, b) => +a.start - +b.start || a.slot.practitioner.localeCompare(b.slot.practitioner));
  return {
    ok: true,
    medicalService: name,
    slots: times.slice(0, timesPerCall).map((one) => one.slot),
    more: times.length > timesPerCall,
  } as const;
}

/**
 * The free time `slotId` names while find_booking_times would offer it now:
 * its medical service, practitioner, room and span, and what the patient
 * reads of it; or `notFree`.
 */
export function bookingSlotFor(database: Database, slotId: string) {
  const [medicalServiceId = ""] = slotId.split("@");
  const row = offering(database, eq(medicalService.id, medicalServiceId)).find(bookable);
  const free = row && freeTimesOf(database, row, Date.now()).find((one) => one.slotId === slotId);
  if (!row || !free) {
    return { ok: false, reason: "notFree" } as const;
  }
  return {
    ok: true,
    slot: {
      medicalServiceId: row.id,
      medicalService: row.name,
      practitionerId: row.practitionerId,
      practitioner: row.practitioner,
      roomId: free.roomId,
      start: free.start,
      end: new Date(+free.start + row.durationMinutes * 60_000),
      date: free.date,
      time: free.time,
    },
  } as const;
}
