import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type * as z from "zod";

import {
  appointment,
  medicalService,
  member,
  office,
  practitioner,
  room,
  schedule,
} from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { actsForEveryone, parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import {
  activeAppointmentStatuses,
  calendarWeekQuerySchema,
  mondayOf,
} from "#/lib/appointments.ts";
import type { CalendarWeekQuery } from "#/lib/appointments.ts";
import { occurrencesDuring } from "#/lib/availability.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { shiftDate } from "#/lib/schedules.ts";
import { toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

import {
  booksForSome,
  findFreeCells,
  selectDayAppointments,
  shownOnCalendar,
  toDayAppointment,
} from "#/server/appointments.ts";
import type { DayAppointment } from "#/server/appointments.ts";
import { findBlocking, meets } from "#/server/availability.ts";

// The calendar (docs/domain/appointments.md § Calendar): one room's week,
// Monday to Sunday in its office's zone, narrowed to a practitioner or a
// medical service. Its free cells are those a matching practitioner the actor
// books for can be booked from. A practitioner who does not book for everyone
// gets other practitioners' appointments as busy blocks, with only when and
// whose, and only those that meet their own working hours in the room. `database` is for tests, which pass a transaction running as the app
// role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

/** An appointment drawn in full: the viewer's own, or any for reception and admins. */
export type CalendarAppointment = DayAppointment & { kind: "appointment" };

/** Another practitioner's active appointment, as a practitioner sees it: only when and whose. */
export interface BusyBlock {
  kind: "busy";
  /** The appointment's id, which says nothing about its patient. */
  id: string;
  /** The part of the appointment inside the viewer's working hours. */
  start: Date;
  end: Date;
  practitionerName: string;
}

export type CalendarCard = CalendarAppointment | BusyBlock;

export interface CalendarDay {
  date: string;
  /** The room's schedules that day, of the practitioners viewed. */
  schedules: TimeRange[];
  /** A free start per practitioner free from it, on the 30-minute cells. */
  freeStarts: { start: Date; practitionerId: string }[];
  cards: CalendarCard[];
}

export interface CalendarPractitioner {
  id: string;
  displayName: string;
  color: PractitionerColor;
}

export interface CalendarWeek {
  room: { id: string; name: string };
  /** The room's office, with its active rooms, where a move or an overbooking can go. */
  office: { id: string; name: string; timeZone: string; rooms: { id: string; name: string }[] };
  /** The practitioners with a schedule or an appointment in the room that week. */
  practitioners: CalendarPractitioner[];
  /** Their active medical services. */
  medicalServices: { id: string; name: string; durationMinutes: number; practitionerId: string }[];
  /** The filters as applied: a medical service sets its practitioner. */
  filter: { practitionerId: string | null; medicalServiceId: string | null };
  days: CalendarDay[];
}

/** The active rooms of each active office, by name: the room picker's choices. */
export interface RoomChoice {
  officeId: string;
  officeName: string;
  rooms: { id: string; name: string }[];
}

const daysInWeek = 7;

async function listRoomChoices(tx: Transaction): Promise<RoomChoice[]> {
  const rows = await tx
    .select({ officeId: office.id, officeName: office.name, id: room.id, name: room.name })
    .from(room)
    .innerJoin(office, and(eq(office.id, room.officeId), eq(office.active, true)))
    .where(eq(room.active, true))
    .orderBy(asc(office.name), asc(office.id), asc(room.name));
  const choices: RoomChoice[] = [];
  for (const { officeId, officeName, id, name } of rows) {
    if (choices.at(-1)?.officeId !== officeId) {
      choices.push({ officeId, officeName, rooms: [] });
    }
    choices.at(-1)!.rooms.push({ id, name });
  }
  return choices;
}

/** The room's schedules that meet the dates, with their practitioner and member. */
function selectRoomSchedules(tx: Transaction, actor: Actor, roomId: string, dates: string[]) {
  return tx
    .select({
      practitionerId: practitioner.id,
      displayName: practitioner.displayName,
      color: practitioner.color,
      gridMinutes: practitioner.gridMinutes,
      userId: member.userId,
      role: member.role,
      memberActive: member.active,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      firstDate: schedule.firstDate,
      lastDate: schedule.lastDate,
    })
    .from(schedule)
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .innerJoin(
      member,
      and(eq(member.id, practitioner.memberId), eq(member.organizationId, actor.organizationId)),
    )
    .where(
      and(
        eq(schedule.roomId, roomId),
        lte(schedule.firstDate, dates.at(-1)!),
        or(isNull(schedule.lastDate), gte(schedule.lastDate, dates[0]!)),
      ),
    )
    .orderBy(asc(practitioner.displayName), asc(practitioner.id));
}

type RoomSchedule = Awaited<ReturnType<typeof selectRoomSchedules>>[number];

/** Each practitioner of the schedules once, in their order. */
function practitionersOf(schedules: readonly RoomSchedule[]) {
  return [...new Map(schedules.map((row) => [row.practitionerId, row])).values()];
}

/**
 * The practitioners with a schedule or an appointment in the room that week,
 * such as an overbooking outside the schedules or a moved appointment, by name.
 */
async function listPractitioners(
  tx: Transaction,
  options: { roomId: string; week: TimeRange; scheduled: readonly RoomSchedule[] },
): Promise<CalendarPractitioner[]> {
  const booked = await tx
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
        meets(appointment.during, options.week),
        // A cancelled or no-show appointment holds no time, and another
        // practitioner never sees it.
        inArray(appointment.status, activeAppointmentStatuses),
      ),
    );
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
async function ownerOfService(
  tx: Transaction,
  medicalServiceId: string | undefined,
  choices: CalendarWeek["medicalServices"],
): Promise<string | undefined> {
  if (medicalServiceId === undefined || choices.some((one) => one.id === medicalServiceId)) {
    return undefined;
  }
  const [found] = await tx
    .select({ practitionerId: medicalService.practitionerId })
    .from(medicalService)
    .where(eq(medicalService.id, medicalServiceId));
  return found?.practitionerId;
}

/** The room and its office; any room the actor's organization holds. */
async function findRoom(tx: Transaction, roomId: string) {
  const [found] = await tx
    .select({
      id: room.id,
      name: room.name,
      officeId: office.id,
      officeName: office.name,
      timeZone: office.timeZone,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, roomId));
  return found;
}

type FoundRoom = NonNullable<Awaited<ReturnType<typeof findRoom>>>;

/** The practitioners' active medical services, by name. */
async function listServices(
  tx: Transaction,
  practitionerIds: string[],
): Promise<CalendarWeek["medicalServices"]> {
  if (practitionerIds.length === 0) {
    return [];
  }
  return tx
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
    .orderBy(asc(medicalService.name), asc(medicalService.id));
}

/** Whether the actor may book for the practitioner of the schedule now. */
function booksFor(actor: Actor, row: RoomSchedule): boolean {
  const holdsRole = row.memberActive && parseRoles(row.role).includes("practitioner");
  return holdsRole && (actsForEveryone(actor) || row.userId === actor.userId);
}

/** The free cells in the room of each practitioner the actor books for, in time order. */
async function findFreeStarts(
  tx: Transaction,
  actor: Actor,
  practitioners: readonly RoomSchedule[],
  options: { window: TimeRange; room: FoundRoom; durationMinutes?: number },
): Promise<CalendarDay["freeStarts"]> {
  const freeStarts: CalendarDay["freeStarts"] = [];
  for (const row of practitioners.filter((one) => booksFor(actor, one))) {
    const free = await findFreeCells(
      tx,
      { id: row.practitionerId, gridMinutes: row.gridMinutes },
      {
        window: options.window,
        officeId: options.room.officeId,
        roomId: options.room.id,
        durationMinutes: options.durationMinutes,
      },
    );
    freeStarts.push(
      ...free.map((slot) => ({ start: slot.start, practitionerId: row.practitionerId })),
    );
  }
  return freeStarts.sort((a, b) => +a.start - +b.start);
}

/**
 * The actor's own working hours in the room that week: their schedules'
 * occurrences there, less their time off and the office's and organization's
 * closures. None for an actor who is not one of the room's practitioners.
 */
async function findOwnHours(
  tx: Transaction,
  actor: Actor,
  options: { schedules: readonly RoomSchedule[]; window: TimeRange; room: FoundRoom },
): Promise<TimeRange[]> {
  const own = options.schedules.filter((row) => row.userId === actor.userId);
  if (own.length === 0) {
    return [];
  }
  const { timeOff, closures } = await findBlocking(tx, own[0]!.practitionerId, options.window, [
    options.room.officeId,
  ]);
  const blocked = [...timeOff, ...closures.map((one) => one.during)];
  return own
    .flatMap((row) =>
      occurrencesDuring({ ...row, timeZone: options.room.timeZone }, options.window),
    )
    .flatMap((hours) => subtract(hours, blocked));
}

/** What of `range` none of `cuts` covers, as the ranges left. */
function subtract(range: TimeRange, cuts: readonly TimeRange[]): TimeRange[] {
  let left = [range];
  for (const cut of cuts) {
    left = left.flatMap((piece) =>
      [
        { start: piece.start, end: cut.start < piece.end ? cut.start : piece.end },
        { start: cut.end > piece.start ? cut.end : piece.start, end: piece.end },
      ].filter((part) => part.start < part.end && (part.end <= cut.start || part.start >= cut.end)),
    );
  }
  return left;
}

/** The week's free starts, cards and schedules, split by local day. */
function splitByDay(
  dates: readonly string[],
  timeZone: string,
  parts: {
    schedules: readonly RoomSchedule[];
    freeStarts: CalendarDay["freeStarts"];
    cards: CalendarCard[];
  },
): CalendarDay[] {
  return dates.map((date) => {
    const range = toTimeRange({ kind: "days", firstDate: date, lastDate: date }, timeZone);
    const within = (instant: Date) => range.start <= instant && instant < range.end;
    // A card across midnight is on both days; the layout clips it to each.
    return {
      date,
      schedules: parts.schedules
        .flatMap((row) => occurrencesDuring({ ...row, timeZone }, range))
        .filter((occurrence) => within(occurrence.start)),
      freeStarts: parts.freeStarts.filter((free) => within(free.start)),
      cards: parts.cards.filter((card) => card.start < range.end && card.end > range.start),
    };
  });
}

/** The week of `found` as the calendar shows it. */
async function buildWeek(
  tx: Transaction,
  actor: Actor,
  found: FoundRoom,
  query: z.output<typeof calendarWeekQuerySchema>,
): Promise<CalendarWeek> {
  const monday = mondayOf(query.date);
  const dates = Array.from({ length: daysInWeek }, (_, offset) => shiftDate(monday, offset));
  const window = toTimeRange(
    { kind: "days", firstDate: dates[0]!, lastDate: dates.at(-1)! },
    found.timeZone,
  );
  const schedules = await selectRoomSchedules(tx, actor, found.id, dates);
  const present = practitionersOf(schedules);
  const practitioners = await listPractitioners(tx, {
    roomId: found.id,
    week: window,
    scheduled: present,
  });
  const medicalServices = await listServices(
    tx,
    practitioners.map((one) => one.id),
  );
  const filter = resolveFilter(
    {
      medicalServiceId: query.medicalServiceId,
      practitionerId:
        query.practitionerId ?? (await ownerOfService(tx, query.medicalServiceId, medicalServices)),
    },
    practitioners,
    medicalServices,
  );
  const viewed = (row: RoomSchedule) =>
    filter.practitionerId === null || row.practitionerId === filter.practitionerId;
  const freeStarts = await findFreeStarts(tx, actor, present.filter(viewed), {
    window,
    room: found,
    durationMinutes: filter.service?.durationMinutes,
  });
  const cards = await findCards(tx, actor, {
    roomId: found.id,
    week: window,
    ownHours: await findOwnHours(tx, actor, { schedules, window, room: found }),
    practitionerId: filter.practitionerId,
    medicalServiceId: filter.medicalServiceId,
    includeCancelledAndNoShow: query.includeCancelledAndNoShow,
  });
  const officeRooms = await tx
    .select({ id: room.id, name: room.name })
    .from(room)
    .where(and(eq(room.officeId, found.officeId), eq(room.active, true)))
    .orderBy(asc(room.name));
  return {
    room: { id: found.id, name: found.name },
    office: {
      id: found.officeId,
      name: found.officeName,
      timeZone: found.timeZone,
      rooms: officeRooms,
    },
    practitioners,
    medicalServices,
    filter: { practitionerId: filter.practitionerId, medicalServiceId: filter.medicalServiceId },
    days: splitByDay(dates, found.timeZone, {
      schedules: schedules.filter(viewed),
      freeStarts,
      cards,
    }),
  };
}

export async function getCalendarWeek(
  actor: Actor,
  input: CalendarWeekQuery,
  database?: AnyDatabase,
): Promise<
  | { ok: true; roomChoices: RoomChoice[]; week: CalendarWeek | null }
  | { ok: false; reason: "forbidden" | "invalidInput" | "notFound" }
> {
  if (!booksForSome(actor)) {
    return { ok: false, reason: "forbidden" };
  }
  const parsed = calendarWeekQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const query = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const roomChoices = await listRoomChoices(tx);
      const roomId = query.roomId ?? roomChoices[0]?.rooms[0]?.id;
      if (roomId === undefined) {
        return { ok: true as const, roomChoices, week: null };
      }
      const found = await findRoom(tx, roomId);
      if (!found) {
        return { ok: false as const, reason: "notFound" as const };
      }
      return { ok: true as const, roomChoices, week: await buildWeek(tx, actor, found, query) };
    },
    database,
  );
}

/**
 * The room's appointments that week, in time order: in full for whoever
 * books for everyone and for their own practitioner, as busy blocks for any
 * other practitioner: only active ones, cut to `ownHours`, their working hours
 * in the room.
 */
async function findCards(
  tx: Transaction,
  actor: Actor,
  options: {
    roomId: string;
    week: TimeRange;
    ownHours: readonly TimeRange[];
    practitionerId: string | null;
    medicalServiceId: string | null;
    includeCancelledAndNoShow: boolean;
  },
): Promise<CalendarCard[]> {
  const rows = await selectDayAppointments(tx, actor)
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
        meets(appointment.during, options.week),
      ),
    )
    .orderBy(asc(appointment.during), asc(appointment.id));
  const active: readonly string[] = activeAppointmentStatuses;
  const now = new Date();
  return rows.flatMap((booked): CalendarCard[] => {
    const own = booked.practitionerUserId === actor.userId;
    if (actsForEveryone(actor) || own) {
      return [
        { kind: "appointment", ...toDayAppointment(booked, { roles: actor.roles, own }, now) },
      ];
    }
    if (!active.includes(booked.status)) {
      return [];
    }
    return clipToHours(booked.during, options.ownHours).map((part, index): BusyBlock => ({
      kind: "busy",
      // Time off can split an appointment; the first part keeps its id.
      id: index === 0 ? booked.id : `${booked.id}-${index}`,
      ...part,
      practitionerName: booked.practitionerName,
    }));
  });
}

/** The parts of `range` inside `hours`, in time order. */
function clipToHours(range: TimeRange, hours: readonly TimeRange[]): TimeRange[] {
  return hours
    .filter((one) => one.start < range.end && range.start < one.end)
    .map((one) => ({
      start: one.start > range.start ? one.start : range.start,
      end: one.end < range.end ? one.end : range.end,
    }))
    .sort((a, b) => +a.start - +b.start);
}
