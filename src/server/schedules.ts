import { and, asc, eq, ne, or } from "drizzle-orm";

import { member, office, practitioner, room, schedule } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import { parseRoles } from "#/lib/access.ts";
import type { Actor } from "#/lib/access.ts";
import {
  datesMeet,
  findCollision,
  scheduleChangeSchema,
  scheduleDeleteSchema,
  scheduleEndSchema,
  scheduleInputSchema,
  shiftDate,
  shortTime,
  today,
} from "#/lib/schedules.ts";
import type {
  ScheduleChange,
  ScheduleDelete,
  ScheduleEnd,
  ScheduleInput,
  WeeklySlot,
} from "#/lib/schedules.ts";

// Practitioners' weekly schedules. Everyone reads them; an admin changes
// anyone's and a practitioner their own. Saving one checks, under locks on the
// practitioner and the room rows, that the room never holds more schedules at
// once than its capacity and the practitioner is never in two at once
// (ADR-0003). `database` is for tests, which pass a transaction running as the
// app role.
//
// `member` is Better Auth's table and has no row-level security (PRD #16), so
// every query on it names the actor's organization itself.

export interface SchedulePractitioner {
  id: string;
  displayName: string;
}

export interface Schedule {
  id: string;
  roomId: string;
  roomName: string;
  officeName: string;
  timeZone: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  firstDate: string;
  lastDate: string | null;
}

/** An active room in an active office, where a schedule can be saved. */
export interface RoomOption {
  id: string;
  name: string;
  officeName: string;
}

/** The schedule a save collides with, and on which weekday. */
export interface Collision {
  practitionerName: string;
  roomName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

type Refusal =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "practitionerInactive"
  | "roomInactive"
  | "officeInactive"
  | "dateInPast"
  | "alreadyStarted"
  | "otherTimeZone";

type CollisionRefusal = {
  ok: false;
  reason: "roomFull" | "practitionerBusy";
  collision: Collision;
};

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

type SaveResult<T> = Result<T> | CollisionRefusal;

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

/** Whether the actor may change schedules at all, before any row is read. */
function mayEditSome(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("practitioner");
}

const scheduleColumns = {
  id: schedule.id,
  practitionerId: schedule.practitionerId,
  roomId: schedule.roomId,
  roomName: room.name,
  officeName: office.name,
  timeZone: office.timeZone,
  weekdays: schedule.weekdays,
  startTime: schedule.startTime,
  endTime: schedule.endTime,
  firstDate: schedule.firstDate,
  lastDate: schedule.lastDate,
};

type ScheduleRow = Schedule & { practitionerId: string };

function selectSchedules(tx: Transaction) {
  return tx
    .select(scheduleColumns)
    .from(schedule)
    .innerJoin(room, eq(room.id, schedule.roomId))
    .innerJoin(office, eq(office.id, room.officeId));
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    officeName: row.officeName,
    timeZone: row.timeZone,
    weekdays: row.weekdays,
    startTime: shortTime(row.startTime),
    endTime: shortTime(row.endTime),
    firstDate: row.firstDate,
    lastDate: row.lastDate,
  };
}

/**
 * The practitioner with their member's status, and whether the actor may
 * change their schedules (and their time off). `lock` takes the practitioner row for the rest of
 * the transaction, so two saves for one practitioner run one after the other.
 */
export async function findPractitioner(
  tx: Transaction,
  actor: Actor,
  practitionerId: string,
  lock: boolean,
) {
  if (lock) {
    // A lock of its own: drizzle qualifies `for update of` with the schema,
    // which Postgres refuses.
    await tx
      .select({ id: practitioner.id })
      .from(practitioner)
      .where(eq(practitioner.id, practitionerId))
      .for("update");
  }
  const [found] = await tx
    .select({
      id: practitioner.id,
      displayName: practitioner.displayName,
      gridMinutes: practitioner.gridMinutes,
      userId: member.userId,
      role: member.role,
      memberActive: member.active,
    })
    .from(practitioner)
    .innerJoin(
      member,
      and(eq(member.id, practitioner.memberId), eq(member.organizationId, actor.organizationId)),
    )
    .where(eq(practitioner.id, practitionerId));
  if (!found) {
    return undefined;
  }
  const { userId, role, memberActive, ...rest } = found;
  const holdsRole = parseRoles(role).includes("practitioner");
  return {
    ...rest,
    active: memberActive && holdsRole,
    canEdit:
      actor.roles.includes("admin") ||
      (actor.roles.includes("practitioner") && userId === actor.userId),
  };
}

export async function listSchedulePractitioners(
  actor: Actor,
  database?: AnyDatabase,
): Promise<SchedulePractitioner[]> {
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select({ id: practitioner.id, displayName: practitioner.displayName, role: member.role })
        .from(practitioner)
        .innerJoin(
          member,
          and(
            eq(member.id, practitioner.memberId),
            eq(member.organizationId, actor.organizationId),
            eq(member.active, true),
          ),
        )
        .orderBy(asc(practitioner.displayName));
      return rows
        .filter((row) => parseRoles(row.role).includes("practitioner"))
        .map(({ id, displayName }) => ({ id, displayName }));
    },
    database,
  );
}

/** A practitioner's schedules, ended ones included, and the rooms a new one can use. */
export async function getPractitionerSchedules(
  actor: Actor,
  input: { practitionerId: string },
  database?: AnyDatabase,
): Promise<
  Result<{
    practitioner: SchedulePractitioner & { canEdit: boolean; active: boolean };
    schedules: Schedule[];
    rooms: RoomOption[];
  }>
> {
  const parsed = scheduleInputSchema.shape.practitionerId.safeParse(input.practitionerId);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, parsed.data, false);
      if (!found) {
        return notFound;
      }
      const rows = await selectSchedules(tx)
        .where(eq(schedule.practitionerId, found.id))
        .orderBy(asc(schedule.firstDate), asc(schedule.startTime));
      const rooms = await tx
        .select({ id: room.id, name: room.name, officeName: office.name })
        .from(room)
        .innerJoin(office, eq(office.id, room.officeId))
        .where(and(eq(room.active, true), eq(office.active, true)))
        .orderBy(asc(office.name), asc(room.name));
      return {
        ok: true as const,
        practitioner: {
          id: found.id,
          displayName: found.displayName,
          canEdit: found.canEdit,
          active: found.active,
        },
        schedules: rows.map(toSchedule),
        rooms,
      };
    },
    database,
  );
}

/** A schedule about to be saved: who, where and when. */
type Candidate = WeeklySlot & { practitionerId: string; roomId: string };

function describeCollision(row: ScheduleRow & { practitionerName: string }, weekday: number) {
  return {
    practitionerName: row.practitionerName,
    roomName: row.roomName,
    weekday,
    startTime: shortTime(row.startTime),
    endTime: shortTime(row.endTime),
  };
}

/**
 * Checks `candidate` against the room and the practitioner's other schedules,
 * all but `replacing`. The caller has locked the practitioner row; the room
 * row is locked here, after it, so concurrent saves take both in one order.
 */
async function checkCandidate(
  tx: Transaction,
  candidate: Candidate,
  replacing: string | null,
): Promise<{ ok: true; timeZone: string } | { ok: false; reason: Refusal } | CollisionRefusal> {
  await tx.select({ id: room.id }).from(room).where(eq(room.id, candidate.roomId)).for("update");
  const [target] = await tx
    .select({
      active: room.active,
      capacity: room.capacity,
      officeActive: office.active,
      timeZone: office.timeZone,
    })
    .from(room)
    .innerJoin(office, eq(office.id, room.officeId))
    .where(eq(room.id, candidate.roomId));
  if (!target) {
    return notFound;
  }
  if (!target.officeActive) {
    return { ok: false, reason: "officeInactive" };
  }
  if (!target.active) {
    return { ok: false, reason: "roomInactive" };
  }

  const others = await tx
    .select({ ...scheduleColumns, practitionerName: practitioner.displayName })
    .from(schedule)
    .innerJoin(room, eq(room.id, schedule.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .where(
      and(
        or(
          eq(schedule.roomId, candidate.roomId),
          eq(schedule.practitionerId, candidate.practitionerId),
        ),
        replacing === null ? undefined : ne(schedule.id, replacing),
      ),
    );

  // The collision check compares local times, which only means one moment within
  // one zone, so a practitioner works in a single zone at a time.
  const abroad = others.some(
    (row) =>
      row.practitionerId === candidate.practitionerId &&
      row.timeZone !== target.timeZone &&
      datesMeet(row, candidate),
  );
  if (abroad) {
    return { ok: false, reason: "otherTimeZone" };
  }

  const roomClash = findCollision(
    candidate,
    others.filter((row) => row.roomId === candidate.roomId),
    target.capacity,
  );
  if (roomClash) {
    return {
      ok: false,
      reason: "roomFull",
      collision: describeCollision(roomClash.schedule, roomClash.weekday),
    };
  }
  const ownClash = findCollision(
    candidate,
    others.filter((row) => row.practitionerId === candidate.practitionerId),
    1,
  );
  if (ownClash) {
    return {
      ok: false,
      reason: "practitionerBusy",
      collision: describeCollision(ownClash.schedule, ownClash.weekday),
    };
  }
  return { ok: true, timeZone: target.timeZone };
}

export async function createSchedule(
  actor: Actor,
  input: ScheduleInput,
  database?: AnyDatabase,
): Promise<SaveResult<{ schedule: { id: string } }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const candidate = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const owner = await findPractitioner(tx, actor, candidate.practitionerId, true);
      if (!owner) {
        return notFound;
      }
      if (!owner.canEdit) {
        return forbidden;
      }
      if (!owner.active) {
        return { ok: false as const, reason: "practitionerInactive" as const };
      }
      const checked = await checkCandidate(tx, candidate, null);
      if (!checked.ok) {
        return checked;
      }
      const [created] = await tx
        .insert(schedule)
        .values({ ...candidate, organizationId: actor.organizationId })
        .returning({ id: schedule.id });
      return { ok: true as const, schedule: created! };
    },
    database,
  );
}

/**
 * The schedule and its practitioner, locked, when the actor may change it.
 * Past weeks are judged by today's date in the schedule's office's zone.
 */
async function findEditable(tx: Transaction, actor: Actor, scheduleId: string) {
  // The schedule is read only once its practitioner is locked, so a change
  // committed while this call waited for the lock is the one it sees. A
  // schedule's practitioner never changes, so it can be read before.
  const [target] = await tx
    .select({ practitionerId: schedule.practitionerId })
    .from(schedule)
    .where(eq(schedule.id, scheduleId));
  if (!target) {
    return notFound;
  }
  const owner = await findPractitioner(tx, actor, target.practitionerId, true);
  if (!owner) {
    return notFound;
  }
  if (!owner.canEdit) {
    return forbidden;
  }
  const [found] = await selectSchedules(tx).where(eq(schedule.id, scheduleId));
  if (!found) {
    return notFound;
  }
  return { ok: true as const, found, owner, today: today(found.timeZone) };
}

/**
 * Applies new fields from `from` on. A schedule that has started ends the day
 * before `from` and a new one carries the fields, so past weeks are never
 * rewritten; one that has not started is edited in place, its first date
 * becoming `from`.
 */
export async function changeSchedule(
  actor: Actor,
  input: ScheduleChange,
  database?: AnyDatabase,
): Promise<SaveResult<{ schedule: { id: string } }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = scheduleChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { scheduleId, from, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const editable = await findEditable(tx, actor, scheduleId);
      if (!editable.ok) {
        return editable;
      }
      const { found, owner } = editable;
      if (from < editable.today) {
        return { ok: false as const, reason: "dateInPast" as const };
      }
      if (found.lastDate !== null && from > found.lastDate) {
        return invalidInput;
      }
      if (!owner.active) {
        return { ok: false as const, reason: "practitionerInactive" as const };
      }
      const candidate = { ...fields, practitionerId: owner.id, firstDate: from };
      // The old schedule ends before `from` in either case, so it never meets
      // the candidate and is left out of the check.
      const checked = await checkCandidate(tx, candidate, found.id);
      if (!checked.ok) {
        return checked;
      }
      const started = found.firstDate <= editable.today && found.firstDate < from;
      if (!started) {
        await tx.update(schedule).set(candidate).where(eq(schedule.id, found.id));
        return { ok: true as const, schedule: { id: found.id } };
      }
      await tx
        .update(schedule)
        .set({ lastDate: shiftDate(from, -1) })
        .where(eq(schedule.id, found.id));
      const [created] = await tx
        .insert(schedule)
        .values({ ...candidate, organizationId: actor.organizationId })
        .returning({ id: schedule.id });
      return { ok: true as const, schedule: created! };
    },
    database,
  );
}

/**
 * Sets the last date a schedule applies. Ending only shortens it, so it needs
 * no collision check; it can end yesterday at the earliest.
 */
export async function endSchedule(
  actor: Actor,
  input: ScheduleEnd,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = scheduleEndSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { scheduleId, lastDate } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const editable = await findEditable(tx, actor, scheduleId);
      if (!editable.ok) {
        return editable;
      }
      const { found } = editable;
      if (lastDate < shiftDate(editable.today, -1)) {
        return { ok: false as const, reason: "dateInPast" as const };
      }
      const extends_ = found.lastDate !== null && lastDate > found.lastDate;
      if (lastDate < found.firstDate || extends_) {
        return invalidInput;
      }
      await tx.update(schedule).set({ lastDate }).where(eq(schedule.id, found.id));
      return { ok: true as const };
    },
    database,
  );
}

/** Deletes a schedule that has not started; a started one keeps its record. */
export async function deleteSchedule(
  actor: Actor,
  input: ScheduleDelete,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = scheduleDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const editable = await findEditable(tx, actor, parsed.data.scheduleId);
      if (!editable.ok) {
        return editable;
      }
      if (editable.found.firstDate <= editable.today) {
        return { ok: false as const, reason: "alreadyStarted" as const };
      }
      await tx.delete(schedule).where(eq(schedule.id, editable.found.id));
      return { ok: true as const };
    },
    database,
  );
}
