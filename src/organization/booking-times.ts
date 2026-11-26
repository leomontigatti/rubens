import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, eq } from "drizzle-orm";

import { assistantToolSchemas } from "#/lib/assistant.ts";
import { formatDay, formatTime, practiceTimeZone } from "#/lib/dates.ts";
import { present } from "#/lib/present.ts";

import { findFreeTimes } from "#/organization/availability.ts";
import type { Database } from "#/organization/database.ts";
import { medicalService, member, practitioner } from "#/organization/schema.ts";

// The free times the patient assistant offers for a new appointment
// (docs/domain/assistant.md § For patients): from the same availability staff
// see, on each practitioner's grid, for the medical service's duration, never
// an overbooking, from now to 60 days ahead. Moving an appointment has its own
// (`moves.ts`).

/** How far ahead the times offered reach, with no setting. */
const bookingWindowMs = 60 * 24 * 60 * 60_000;

/** How many times one call returns: the few nearest to what the patient prefers. */
const timesPerCall = 5;

/** The rows of the medical service the patient asked for, of active practitioners, by name. */
function requested(database: Database, name: string, practitionerName: string | undefined) {
  return database
    .select({
      id: medicalService.id,
      active: medicalService.active,
      whatsappBooking: medicalService.whatsappBooking,
      durationMinutes: medicalService.durationMinutes,
      practitionerId: practitioner.id,
      practitioner: practitioner.displayName,
      gridMinutes: practitioner.gridMinutes,
    })
    .from(medicalService)
    .innerJoin(practitioner, eq(practitioner.id, medicalService.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(
      and(
        eq(medicalService.name, name),
        practitionerName === undefined ? undefined : eq(practitioner.displayName, practitionerName),
        eq(member.active, true),
      ),
    )
    .all();
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
  const rows = requested(database, name, practitionerName);
  if (rows.length === 0) {
    return { ok: false, reason: "notFound" } as const;
  }
  const active = rows.filter((row) => row.active);
  if (active.length === 0) {
    return { ok: false, reason: "archived" } as const;
  }
  const bookable = active.filter((row) => row.whatsappBooking);
  if (bookable.length === 0) {
    return { ok: false, reason: "whatsappBookingOff" } as const;
  }
  const now = Date.now();
  const window = { start: new Date(now), end: new Date(now + bookingWindowMs) };
  // A date reads as the start of its day: "2099-01-19" sorts before "2099-01-19T09:00".
  const times = bookable
    .flatMap((row) => {
      const { free, schedules } = findFreeTimes(
        database,
        { id: row.practitionerId, gridMinutes: row.gridMinutes },
        { window, durationMinutes: row.durationMinutes },
      );
      const rooms = new Map(schedules.map((one) => [one.roomId, one.roomName]));
      return free.map(({ start, roomId }) => ({
        start,
        localStart: format(start, "yyyy-MM-dd'T'HH:mm", { in: tz(practiceTimeZone) }),
        slot: {
          slotId: `${row.id}@${start.toISOString()}`,
          practitioner: row.practitioner,
          room: present(rooms.get(roomId), "A free time is in the room of one of its schedules"),
          date: formatDay(start, practiceTimeZone),
          time: formatTime(start, practiceTimeZone),
        },
      }));
    })
    .filter((one) => one.localStart >= from)
    .sort((a, b) => +a.start - +b.start || a.slot.practitioner.localeCompare(b.slot.practitioner));
  return {
    ok: true,
    medicalService: name,
    slots: times.slice(0, timesPerCall).map((one) => one.slot),
    more: times.length > timesPerCall,
  } as const;
}
