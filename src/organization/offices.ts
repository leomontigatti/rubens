import { and, asc, eq } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import {
  activeChangeSchema,
  officeInputSchema,
  officeUpdateSchema,
  roomInputSchema,
  roomUpdateSchema,
} from "#/lib/offices.ts";
import type {
  ActiveChange,
  OfficeInput,
  OfficeUpdate,
  RoomInput,
  RoomUpdate,
} from "#/lib/offices.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { office, room } from "#/organization/schema.ts";

// The organization's offices and their rooms. Everyone reads them; only an
// admin changes them (the object's requirement). Nothing is deleted: a
// deactivated office or room drops out of the default lists and can be
// reactivated. Every change is written to the audit log, about no patient.

const officeColumns = {
  id: office.id,
  name: office.name,
  address: office.address,
  timeZone: office.timeZone,
  active: office.active,
};

const roomColumns = {
  id: room.id,
  officeId: room.officeId,
  name: room.name,
  capacity: room.capacity,
  active: room.active,
};

export interface Office {
  id: string;
  name: string;
  address: string;
  timeZone: string;
  active: boolean;
}

export interface Room {
  id: string;
  officeId: string;
  name: string;
  capacity: number;
  active: boolean;
}

type Refusal = "invalidInput" | "notFound" | "officeInactive";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const officeInactive = { ok: false, reason: "officeInactive" } as const;

export interface ListOptions {
  includeInactive: boolean;
}

/**
 * The offices, and `onlyInactive`: the default list shows none, yet some
 * exist, all inactive.
 */
export function listOffices(
  database: Database,
  options: ListOptions,
): { ok: true; offices: Office[]; onlyInactive: boolean } {
  const offices = database
    .select(officeColumns)
    .from(office)
    .where(options.includeInactive ? undefined : eq(office.active, true))
    .orderBy(asc(office.name))
    .all();
  const onlyInactive =
    !options.includeInactive &&
    offices.length === 0 &&
    database.select({ id: office.id }).from(office).limit(1).get() !== undefined;
  return { ok: true, offices, onlyInactive };
}

/** An office and its rooms, with `onlyInactive` as `listOffices` says, for its rooms. */
export function getOffice(
  database: Database,
  input: { officeId: string } & ListOptions,
): Result<{ office: Office; rooms: Room[]; onlyInactive: boolean }> {
  const found = database
    .select(officeColumns)
    .from(office)
    .where(eq(office.id, input.officeId))
    .get();
  if (!found) {
    return notFound;
  }
  const rooms = database
    .select(roomColumns)
    .from(room)
    .where(
      and(eq(room.officeId, found.id), input.includeInactive ? undefined : eq(room.active, true)),
    )
    .orderBy(asc(room.name))
    .all();
  const onlyInactive =
    !input.includeInactive &&
    rooms.length === 0 &&
    database
      .select({ id: room.id })
      .from(room)
      .where(eq(room.officeId, found.id))
      .limit(1)
      .get() !== undefined;
  return { ok: true, office: found, rooms, onlyInactive };
}

export function createOffice(
  database: Database,
  acting: Acting,
  input: OfficeInput,
): Result<{ office: Office }> {
  const parsed = officeInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    const created = tx.insert(office).values(parsed.data).returning(officeColumns).get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "office",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(parsed.data),
    });
    return { ok: true as const, office: created };
  });
}

export function updateOffice(
  database: Database,
  acting: Acting,
  input: OfficeUpdate,
): Result<{ office: Office }> {
  const parsed = officeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { officeId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = tx.select(officeColumns).from(office).where(eq(office.id, officeId)).get();
    if (!current) {
      return notFound;
    }
    const updated = tx
      .update(office)
      .set(fields)
      .where(eq(office.id, officeId))
      .returning(officeColumns)
      .get();
    const changed = changedFields(current, fields);
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "office",
        entityId: officeId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, office: updated };
  });
}

export function setOfficeActive(
  database: Database,
  acting: Acting,
  input: ActiveChange,
): Result<object> {
  return setActive(database, acting, input, "office");
}

export function createRoom(
  database: Database,
  acting: Acting,
  input: RoomInput,
): Result<{ room: Room }> {
  const parsed = roomInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return database.transaction((tx) => {
    const parent = tx
      .select({ active: office.active })
      .from(office)
      .where(eq(office.id, parsed.data.officeId))
      .get();
    if (!parent) {
      return notFound;
    }
    // A deactivated office keeps its rooms as they were, reactivating one
    // included, but gets no new ones.
    if (!parent.active) {
      return officeInactive;
    }
    const created = tx.insert(room).values(parsed.data).returning(roomColumns).get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "room",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(parsed.data),
    });
    return { ok: true as const, room: created };
  });
}

export function updateRoom(
  database: Database,
  acting: Acting,
  input: RoomUpdate,
): Result<{ room: Room }> {
  const parsed = roomUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { roomId, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = tx.select(roomColumns).from(room).where(eq(room.id, roomId)).get();
    if (!current) {
      return notFound;
    }
    const updated = tx
      .update(room)
      .set(fields)
      .where(eq(room.id, roomId))
      .returning(roomColumns)
      .get();
    const changed = changedFields(current, fields);
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "room",
        entityId: roomId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, room: updated };
  });
}

export function setRoomActive(
  database: Database,
  acting: Acting,
  input: ActiveChange,
): Result<object> {
  return setActive(database, acting, input, "room");
}

/** Deactivates or reactivates an office or a room; one already in that state changes nothing. */
function setActive(
  database: Database,
  acting: Acting,
  input: ActiveChange,
  entityType: "office" | "room",
): Result<object> {
  const parsed = activeChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  const table = entityType === "office" ? office : room;
  return database.transaction((tx: Writer) => {
    const current = tx.select({ active: table.active }).from(table).where(eq(table.id, id)).get();
    if (!current) {
      return notFound;
    }
    if (current.active !== active) {
      tx.update(table).set({ active }).where(eq(table.id, id)).run();
      recordAudit(tx, acting.userId, {
        action: active ? "reactivate" : "deactivate",
        entityType,
        entityId: id,
        patientId: null,
        before: { active: !active },
        after: { active },
      });
    }
    return { ok: true as const };
  });
}
