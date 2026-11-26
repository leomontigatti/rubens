import { practiceTimeZone } from "#/lib/dates.ts";
import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type * as z from "zod";

import { actsForEveryone } from "#/lib/access.ts";
import {
  activeAppointmentStatuses,
  calendarWeekQuerySchema,
  mondayOf,
} from "#/lib/appointments.ts";
import type { CalendarWeekQuery } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import { cellMinutes } from "#/lib/calendar-layout.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import { selectDayAppointments, toDayAppointment } from "#/organization/appointments.ts";
import type { DayAppointment } from "#/organization/appointments.ts";
import { findFreeTimes, meets } from "#/organization/availability.ts";
import { findCalendarOpening } from "#/organization/calendar-opening.ts";
import type { Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import {
  appointment,
  medicalService,
  member,
  office,
  practitioner,
  room,
  schedule,
} from "#/organization/schema.ts";

// The calendar (docs/domain/appointments.md § Calendar): one room's week,
// Monday to Sunday in the practice's zone, narrowed to a practitioner or a
// medical service. Its free cells are those a matching practitioner `acting`
// books for can be booked from. A practitioner who does not book for everyone
// gets only their own appointments.

/** An appointment drawn in full: the viewer's own, or any for reception and admins. */
export type CalendarAppointment = DayAppointment;

export interface CalendarDay {
  date: string;
  /** The room's schedules that day, of the practitioners viewed. */
  schedules: TimeRange[];
  /** A free start per practitioner free from it, on the 30-minute cells. */
  freeStarts: { start: Date; practitionerId: string }[];
  cards: CalendarAppointment[];
}

interface CalendarPractitioner {
  id: string;
  displayName: string;
  color: PractitionerColor;
}

export interface CalendarWeek {
  room: { id: string; name: string };
  /** The room's office, with its active rooms, where a move or an overbooking can go. */
  office: { id: string; rooms: { id: string; name: string }[] };
  /** The practitioners with a schedule or an appointment in the room that week. */
  practitioners: CalendarPractitioner[];
  /** Their active medical services. */
  medicalServices: { id: string; name: string; durationMinutes: number; practitionerId: string }[];
  /** The filters as applied: a medical service sets its practitioner. */
  filter: { practitionerId: string | null; medicalServiceId: string | null };
  days: CalendarDay[];
}

/** An active room, the room picker's choices listing them by name. */
export interface RoomChoice {
  id: string;
  name: string;
}

type Query = z.output<typeof calendarWeekQuerySchema>;

const daysInWeek = 7;

/**
 * The calendar leaves out cancelled and no-show appointments unless asked
 * for: their time is free again.
 */
function shownOnCalendar(includeCancelledAndNoShow: boolean) {
  return includeCancelledAndNoShow
    ? undefined
    : inArray(appointment.status, [...activeAppointmentStatuses]);
}

function listRoomChoices(writer: Writer): RoomChoice[] {
  return writer
    .select({ id: room.id, name: room.name })
    .from(room)
    .innerJoin(office, and(eq(office.id, room.officeId), eq(office.active, true)))
    .where(eq(room.active, true))
    .orderBy(asc(room.name), asc(room.id))
    .all();
}

/** The room's schedules that meet the dates, with their practitioner and member. */
function selectRoomSchedules(
  writer: Writer,
  roomId: string,
  dates: { firstDate: string; lastDate: string },
) {
  return writer
    .select({
      practitionerId: practitioner.id,
      displayName: practitioner.displayName,
      color: practitioner.color,
      gridMinutes: practitioner.gridMinutes,
      userId: member.userId,
      roles: member.roles,
      memberActive: member.active,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .innerJoin(member, eq(member.userId, practitioner.memberId))
    .where(
      and(
        eq(schedule.roomId, roomId),
        lte(schedule.firstDate, dates.lastDate),
        or(isNull(schedule.lastDate), gte(schedule.lastDate, dates.firstDate)),
      ),
    )
    .orderBy(asc(practitioner.displayName), asc(practitioner.id))
    .all();
}

type RoomSchedule = ReturnType<typeof selectRoomSchedules>[number];

/** Each practitioner of the schedules once, in their order. */
function practitionersOf(schedules: readonly RoomSchedule[]) {
  return [...new Map(schedules.map((row) => [row.practitionerId, row])).values()];
}

/**
 * The practitioners with a schedule or an appointment in the room that week,
 * such as an overbooking outside the schedules or a moved appointment, by name.
 * A cancelled or no-show appointment counts only when the calendar shows them
 * and `acting` books for everyone: it holds no time, and another practitioner
 * never sees it.
 */
function listPractitioners(
  writer: Writer,
  acting: Acting,
  options: {
    roomId: string;
    week: TimeRange;
    scheduled: readonly RoomSchedule[];
    includeCancelledAndNoShow: boolean;
  },
): CalendarPractitioner[] {
  const booked = writer
    .selectDistinct({
      id: practitioner.id,
      displayName: practitioner.displayName,
      color: practitioner.color,
    })
    .from(appointment)
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .where(
      and(
        eq(appointment.roomId, options.roomId),
        meets(appointment, options.week),
        shownOnCalendar(options.includeCancelledAndNoShow && actsForEveryone(acting)),
      ),
    )
    .all();
  const scheduled = options.scheduled.map((row) => ({
    id: row.practitionerId,
    displayName: row.displayName,
    color: row.color,
  }));
  return [...new Map([...scheduled, ...booked].map((one) => [one.id, one])).values()].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id),
  );
}

/**
 * The filters that apply to the room that week: a medical service when it is
 * an active one of a practitioner listed, setting its practitioner; else the
 * practitioner when listed. Anything else in the URL is ignored.
 */
function resolveFilter(
  query: { practitionerId?: string; medicalServiceId?: string },
  practitioners: readonly CalendarPractitioner[],
  services: CalendarWeek["medicalServices"],
) {
  const service = services.find((one) => one.id === query.medicalServiceId);
  if (service) {
    return { practitionerId: service.practitionerId, medicalServiceId: service.id, service };
  }
  const listed = practitioners.find((one) => one.id === query.practitionerId);
  return { practitionerId: listed?.id ?? null, medicalServiceId: null, service: null };
}

/**
 * The practitioner of a medical service the URL names that is not among the
 * week's choices (deactivated since, say), so the filter keeps them.
 */
function ownerOfService(
  writer: Writer,
  medicalServiceId: string | undefined,
  choices: CalendarWeek["medicalServices"],
): string | undefined {
  if (medicalServiceId === undefined || choices.some((one) => one.id === medicalServiceId)) {
    return undefined;
  }
  return writer
    .select({ practitionerId: medicalService.practitionerId })
    .from(medicalService)
    .where(eq(medicalService.id, medicalServiceId))
    .get()?.practitionerId;
}

/** The room and its office. */
function findRoom(writer: Writer, roomId: string) {
  return writer
    .select({
      id: room.id,
      name: room.name,
      officeId: office.id,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, roomId))
    .get();
}

type FoundRoom = NonNullable<ReturnType<typeof findRoom>>;

/** The practitioners' active medical services, by name. */
function listServices(writer: Writer, practitionerIds: string[]): CalendarWeek["medicalServices"] {
  if (practitionerIds.length === 0) {
    return [];
  }
  return writer
    .select({
      id: medicalService.id,
      name: medicalService.name,
      durationMinutes: medicalService.durationMinutes,
      practitionerId: medicalService.practitionerId,
    })
    .from(medicalService)
    .where(
      and(inArray(medicalService.practitionerId, practitionerIds), eq(medicalService.active, true)),
    )
    .orderBy(asc(medicalService.name), asc(medicalService.id))
    .all();
}

/** Whether `acting` may book for the practitioner of the schedule now. */
function booksFor(acting: Acting, row: RoomSchedule): boolean {
  const holdsRole = row.memberActive && row.roles.includes("practitioner");
  return holdsRole && (actsForEveryone(acting) || row.userId === acting.userId);
}

/**
 * The free cells in the room of each practitioner `acting` books for, in time
 * order: starts on the cells' grid from local midnight that are also free
 * starts on the practitioner's own grid, for a cell or for `durationMinutes`.
 */
function findFreeCells(
  writer: Writer,
  acting: Acting,
  practitioners: readonly RoomSchedule[],
  options: { window: TimeRange; room: FoundRoom; durationMinutes?: number },
): CalendarDay["freeStarts"] {
  const { window, room: found, durationMinutes = cellMinutes } = options;
  const onCellGrid = (start: Date) =>
    Number(format(start, "m", { in: tz(practiceTimeZone) })) % cellMinutes === 0;
  return practitioners
    .filter((one) => booksFor(acting, one))
    .flatMap((row) =>
      findFreeTimes(
        writer,
        { id: row.practitionerId, gridMinutes: row.gridMinutes },
        { window, officeId: found.officeId, durationMinutes },
      )
        .free.filter((slot) => slot.roomId === found.id && onCellGrid(slot.start))
        .map((slot) => ({ start: slot.start, practitionerId: row.practitionerId })),
    )
    .sort((a, b) => +a.start - +b.start);
}

/**
 * The room's appointments that week `acting` sees, in time order: all of them
 * for whoever books for everyone, else their own.
 */
function findCards(
  writer: Writer,
  acting: Acting,
  options: {
    roomId: string;
    week: TimeRange;
    practitionerId: string | null;
    medicalServiceId: string | null;
    includeCancelledAndNoShow: boolean;
  },
): CalendarAppointment[] {
  const rows = selectDayAppointments(writer)
    .where(
      and(
        eq(appointment.roomId, options.roomId),
        options.practitionerId === null
          ? undefined
          : eq(appointment.practitionerId, options.practitionerId),
        options.medicalServiceId === null
          ? undefined
          : eq(appointment.medicalServiceId, options.medicalServiceId),
        shownOnCalendar(options.includeCancelledAndNoShow),
        meets(appointment, options.week),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(appointment.endsAt), asc(appointment.id))
    .all();
  const now = new Date();
  return rows.flatMap((booked) => {
    const own = booked.practitionerUserId === acting.userId;
    return actsForEveryone(acting) || own
      ? [toDayAppointment(booked, { roles: acting.roles, own }, now)]
      : [];
  });
}

/** The week's free starts, cards and schedules, split by local day. */
function splitByDay(
  dates: readonly string[],
  parts: {
    schedules: readonly RoomSchedule[];
    freeStarts: CalendarDay["freeStarts"];
    cards: CalendarAppointment[];
  },
): CalendarDay[] {
  return dates.map((date) => {
    const range = toTimeRange({ kind: "days", firstDate: date, lastDate: date }, practiceTimeZone);
    const within = (instant: Date) => range.start <= instant && instant < range.end;
    // A card across midnight is on both days; the layout clips it to each.
    return {
      date,
      schedules: parts.schedules
        .flatMap((row) => occurrencesDuring(row, range))
        .filter((occurrence) => within(occurrence.start)),
      freeStarts: parts.freeStarts.filter((free) => within(free.start)),
      cards: parts.cards.filter((card) => card.start < range.end && card.end > range.start),
    };
  });
}

/** The week of `found` as the calendar shows it. */
function buildWeek(writer: Writer, acting: Acting, found: FoundRoom, query: Query): CalendarWeek {
  const monday = mondayOf(query.date);
  const dates = Array.from({ length: daysInWeek }, (_, offset) => shiftDate(monday, offset));
  const bounds = { firstDate: monday, lastDate: shiftDate(monday, daysInWeek - 1) };
  const window = toTimeRange({ kind: "days", ...bounds }, practiceTimeZone);
  const schedules = selectRoomSchedules(writer, found.id, bounds);
  const present = practitionersOf(schedules);
  const practitioners = listPractitioners(writer, acting, {
    roomId: found.id,
    week: window,
    scheduled: present,
    includeCancelledAndNoShow: query.includeCancelledAndNoShow,
  });
  const medicalServices = listServices(
    writer,
    practitioners.map((one) => one.id),
  );
  const filter = resolveFilter(
    {
      medicalServiceId: query.medicalServiceId,
      practitionerId:
        query.practitionerId ?? ownerOfService(writer, query.medicalServiceId, medicalServices),
    },
    practitioners,
    medicalServices,
  );
  const viewed = (row: RoomSchedule) =>
    filter.practitionerId === null || row.practitionerId === filter.practitionerId;
  const freeStarts = findFreeCells(writer, acting, present.filter(viewed), {
    window,
    room: found,
    durationMinutes: filter.service?.durationMinutes,
  });
  const cards = findCards(writer, acting, {
    roomId: found.id,
    week: window,
    practitionerId: filter.practitionerId,
    medicalServiceId: filter.medicalServiceId,
    includeCancelledAndNoShow: query.includeCancelledAndNoShow,
  });
  const officeRooms = writer
    .select({ id: room.id, name: room.name })
    .from(room)
    .where(and(eq(room.officeId, found.officeId), eq(room.active, true)))
    .orderBy(asc(room.name))
    .all();
  return {
    room: { id: found.id, name: found.name },
    office: {
      id: found.officeId,
      rooms: officeRooms,
    },
    practitioners,
    medicalServices,
    filter: { practitionerId: filter.practitionerId, medicalServiceId: filter.medicalServiceId },
    days: splitByDay(dates, {
      schedules: schedules.filter(viewed),
      freeStarts,
      cards,
    }),
  };
}

/** The room and the practitioner to show: what the URL names, else where `acting` opens. */
function resolveView(
  writer: Writer,
  acting: Acting,
  query: Query,
  roomChoices: readonly RoomChoice[],
) {
  if (query.roomId !== undefined) {
    return { roomId: query.roomId, practitionerId: query.practitionerId };
  }
  const roomIds = roomChoices.map((one) => one.id);
  const opening = findCalendarOpening(writer, acting, query.date, roomIds);
  const filtered = query.practitionerId !== undefined || query.medicalServiceId !== undefined;
  return {
    roomId: opening?.roomId ?? roomIds[0],
    practitionerId: filtered ? query.practitionerId : opening?.practitionerId,
  };
}

/** The room choices and the week the query asks for; no week when there is no active room. */
export function getCalendarWeek(
  writer: Writer,
  acting: Acting,
  input: CalendarWeekQuery,
):
  | { ok: true; roomChoices: RoomChoice[]; week: CalendarWeek | null }
  | { ok: false; reason: "invalidInput" | "notFound" } {
  const parsed = calendarWeekQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const query = parsed.data;
  const roomChoices = listRoomChoices(writer);
  const { roomId, practitionerId } = resolveView(writer, acting, query, roomChoices);
  if (roomId === undefined) {
    return { ok: true, roomChoices, week: null };
  }
  const found = findRoom(writer, roomId);
  if (!found) {
    return { ok: false, reason: "notFound" };
  }
  return {
    ok: true,
    roomChoices,
    week: buildWeek(writer, acting, found, { ...query, practitionerId }),
  };
}
