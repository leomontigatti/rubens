import { and, asc, eq, inArray } from "drizzle-orm";

import { appointment, office, practitioner, room, schedule } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { activeAppointmentStatuses, roomDayQuerySchema } from "#/lib/appointments.ts";
import type { RoomDayQuery } from "#/lib/appointments.ts";
import { appliesOn } from "#/lib/availability.ts";
import { instantOf, toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { meets } from "#/server/availability.ts";

// The room view (docs/domain/access.md): who holds each room of an office on
// a local day, through schedules and active appointments, by practitioner.
// Open to every staff role, so it carries nothing about a patient: no name,
// no id, no type and no note. `database` is for tests, which pass a
// transaction running as the app role.

/** A span a practitioner holds a room for. */
export interface RoomBlock {
  kind: "schedule" | "appointment";
  start: Date;
  end: Date;
  practitionerName: string;
  overbooking: boolean;
}

export interface RoomColumn {
  id: string;
  name: string;
  blocks: RoomBlock[];
}

/**
 * The office's rooms on the local `date`, each with its blocks in time order:
 * every active room, and an inactive one only when an appointment holds it.
 */
export async function getRoomDay(
  actor: Actor,
  input: RoomDayQuery,
  database?: AnyDatabase,
): Promise<
  | {
      ok: true;
      office: { id: string; name: string; timeZone: string };
      day: TimeRange;
      rooms: RoomColumn[];
    }
  | { ok: false; reason: "invalidInput" | "notFound" }
> {
  const parsed = roomDayQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { officeId, date } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [found] = await tx
        .select({ id: office.id, name: office.name, timeZone: office.timeZone })
        .from(office)
        .where(eq(office.id, officeId));
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const day = toTimeRange({ kind: "days", firstDate: date, lastDate: date }, found.timeZone);
      const rooms = await tx
        .select({ id: room.id, name: room.name, active: room.active })
        .from(room)
        .where(eq(room.officeId, found.id))
        .orderBy(asc(room.name));
      const scheduleBlocks = (
        await tx
          .select({
            roomId: schedule.roomId,
            practitionerName: practitioner.displayName,
            weekdays: schedule.weekdays,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            firstDate: schedule.firstDate,
            lastDate: schedule.lastDate,
          })
          .from(schedule)
          .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
          .innerJoin(room, and(eq(room.id, schedule.roomId), eq(room.active, true)))
          .where(eq(room.officeId, found.id))
      )
        .filter((row) => appliesOn(row, date))
        .map((row) => ({
          roomId: row.roomId,
          kind: "schedule" as const,
          start: instantOf(date, row.startTime, found.timeZone),
          end: instantOf(date, row.endTime, found.timeZone),
          practitionerName: row.practitionerName,
          overbooking: false,
        }));
      const appointmentBlocks = (
        await tx
          .select({
            roomId: appointment.roomId,
            during: appointment.during,
            practitionerName: practitioner.displayName,
            overbooking: appointment.overbooking,
          })
          .from(appointment)
          .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
          .innerJoin(room, eq(room.id, appointment.roomId))
          .where(
            and(
              eq(room.officeId, found.id),
              inArray(appointment.status, [...activeAppointmentStatuses]),
              meets(appointment.during, day),
            ),
          )
      ).map((row) => ({
        roomId: row.roomId,
        kind: "appointment" as const,
        start: row.during.start,
        end: row.during.end,
        practitionerName: row.practitionerName,
        overbooking: row.overbooking,
      }));
      const blocks = [...scheduleBlocks, ...appointmentBlocks].sort(
        (a, b) => +a.start - +b.start || a.kind.localeCompare(b.kind),
      );
      const columns = rooms
        .map((row) => ({
          id: row.id,
          name: row.name,
          active: row.active,
          blocks: blocks
            .filter((block) => block.roomId === row.id)
            .map(({ roomId: _roomId, ...block }) => block),
        }))
        .filter((column) => column.active || column.blocks.length > 0)
        .map(({ active: _active, ...column }) => column);
      return { ok: true as const, office: found, day, rooms: columns };
    },
    database,
  );
}
