import { createServerFn } from "@tanstack/react-start";

import type { TimeOffDelete, TimeOffInput, TimeOffUpdate } from "#/lib/time-ranges.ts";

import { createTimeOff, deleteTimeOff, listTimeOff, updateTimeOff } from "#/server/time-off.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide whose time off the actor may
// change, so each validator here only names the type. Requiring an admin or a
// practitioner refuses a receptionist before a transaction opens.
const anyRole = { roles: "any" } as const;
const editors = { roles: ["admin", "practitioner"] } as const;

export const getTimeOff = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({ ok: true as const, ...(await listTimeOff(actor)) })),
);

export const addTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => createTimeOff(actor, data)));

export const editTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffUpdate) => data)
  .handler(({ data }) => withActor(editors, (actor) => updateTimeOff(actor, data)));

export const removeTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffDelete) => data)
  .handler(({ data }) => withActor(editors, (actor) => deleteTimeOff(actor, data)));
