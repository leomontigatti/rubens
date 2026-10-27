import { createServerFn } from "@tanstack/react-start";

import type {
  ActiveChange,
  OfficeInput,
  OfficeUpdate,
  RoomInput,
  RoomUpdate,
} from "#/lib/offices.ts";

import {
  createOffice,
  createRoom,
  getOffice,
  listOffices,
  setOfficeActive,
  setRoomActive,
  updateOffice,
  updateRoom,
} from "#/server/offices.ts";
import type { ListOptions } from "#/server/offices.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and refuse non-admins themselves, so each
// validator here only names the type. Requiring the admin role as well refuses
// a change before it opens a transaction.
const anyRole = { roles: "any" } as const;
const adminOnly = { roles: ["admin"] } as const;

export const getOffices = createServerFn({ method: "GET" })
  .validator((data: ListOptions) => data)
  .handler(({ data }) =>
    withActor(anyRole, async (actor) => ({
      ok: true as const,
      offices: await listOffices(actor, { includeInactive: data.includeInactive }),
    })),
  );

export const getOfficeWithRooms = createServerFn({ method: "GET" })
  .validator((data: { officeId: string } & ListOptions) => data)
  .handler(({ data }) => withActor(anyRole, (actor) => getOffice(actor, data)));

export const addOffice = createServerFn({ method: "POST" })
  .validator((data: OfficeInput) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => createOffice(actor, data)));

export const editOffice = createServerFn({ method: "POST" })
  .validator((data: OfficeUpdate) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => updateOffice(actor, data)));

export const changeOfficeActive = createServerFn({ method: "POST" })
  .validator((data: ActiveChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setOfficeActive(actor, data)));

export const addRoom = createServerFn({ method: "POST" })
  .validator((data: RoomInput) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => createRoom(actor, data)));

export const editRoom = createServerFn({ method: "POST" })
  .validator((data: RoomUpdate) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => updateRoom(actor, data)));

export const changeRoomActive = createServerFn({ method: "POST" })
  .validator((data: ActiveChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setRoomActive(actor, data)));
