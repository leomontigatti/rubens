import { and, asc, eq } from "drizzle-orm";

import { office, room } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
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

// The offices and rooms of the actor's organization. Everyone reads them; only
// an admin changes them. Nothing is deleted: a deactivated office or room drops
// out of the default lists and can be reactivated. `database` is for tests,
// which pass a transaction running as the app role.

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

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

export interface ListOptions {
  includeInactive: boolean;
}

export async function listOffices(
  actor: Actor,
  options: ListOptions,
  database?: AnyDatabase,
): Promise<Office[]> {
  return withTenant(
    actor,
    (tx) =>
      tx
        .select(officeColumns)
        .from(office)
        .where(options.includeInactive ? undefined : eq(office.active, true))
        .orderBy(asc(office.name)),
    database,
  );
}

/** An office and its rooms. */
export async function getOffice(
  actor: Actor,
  input: { officeId: string } & ListOptions,
  database?: AnyDatabase,
): Promise<Result<{ office: Office; rooms: Room[] }>> {
  const officeId = officeUpdateSchema.shape.officeId.safeParse(input.officeId);
  if (!officeId.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const [found] = await tx
        .select(officeColumns)
        .from(office)
        .where(eq(office.id, officeId.data));
      if (!found) {
        return notFound;
      }
      const rooms = await tx
        .select(roomColumns)
        .from(room)
        .where(
          and(
            eq(room.officeId, found.id),
            input.includeInactive ? undefined : eq(room.active, true),
          ),
        )
        .orderBy(asc(room.name));
      return { ok: true as const, office: found, rooms };
    },
    database,
  );
}

export async function createOffice(
  actor: Actor,
  input: OfficeInput,
  database?: AnyDatabase,
): Promise<Result<{ office: Office }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = officeInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const [created] = await tx
        .insert(office)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(officeColumns);
      return { ok: true as const, office: created! };
    },
    database,
  );
}

export async function updateOffice(
  actor: Actor,
  input: OfficeUpdate,
  database?: AnyDatabase,
): Promise<Result<{ office: Office }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = officeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { officeId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [updated] = await tx
        .update(office)
        .set(fields)
        .where(eq(office.id, officeId))
        .returning(officeColumns);
      return updated ? { ok: true as const, office: updated } : notFound;
    },
    database,
  );
}

export async function setOfficeActive(
  actor: Actor,
  input: ActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = activeChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const updated = await tx
        .update(office)
        .set({ active: parsed.data.active })
        .where(eq(office.id, parsed.data.id))
        .returning({ id: office.id });
      return updated.length > 0 ? { ok: true as const } : notFound;
    },
    database,
  );
}

export async function createRoom(
  actor: Actor,
  input: RoomInput,
  database?: AnyDatabase,
): Promise<Result<{ room: Room }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = roomInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const [parent] = await tx
        .select({ id: office.id })
        .from(office)
        .where(eq(office.id, parsed.data.officeId));
      if (!parent) {
        return notFound;
      }
      const [created] = await tx
        .insert(room)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(roomColumns);
      return { ok: true as const, room: created! };
    },
    database,
  );
}

export async function updateRoom(
  actor: Actor,
  input: RoomUpdate,
  database?: AnyDatabase,
): Promise<Result<{ room: Room }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = roomUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { roomId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [updated] = await tx
        .update(room)
        .set(fields)
        .where(eq(room.id, roomId))
        .returning(roomColumns);
      return updated ? { ok: true as const, room: updated } : notFound;
    },
    database,
  );
}

export async function setRoomActive(
  actor: Actor,
  input: ActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = activeChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const updated = await tx
        .update(room)
        .set({ active: parsed.data.active })
        .where(eq(room.id, parsed.data.id))
        .returning({ id: room.id });
      return updated.length > 0 ? { ok: true as const } : notFound;
    },
    database,
  );
}
