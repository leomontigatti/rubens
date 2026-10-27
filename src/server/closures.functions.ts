import { createServerFn } from "@tanstack/react-start";

import type { ClosureDelete, ClosureInput, ClosureUpdate } from "#/lib/time-ranges.ts";

import { createClosure, deleteClosure, listClosures, updateClosure } from "#/server/closures.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input, so each validator here only names the
// type. Only admins change closures; everyone reads them.
const anyRole = { roles: "any" } as const;
const adminOnly = { roles: ["admin"] } as const;

export const getClosures = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({ ok: true as const, ...(await listClosures(actor)) })),
);

export const addClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureInput) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => createClosure(actor, data)));

export const editClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureUpdate) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => updateClosure(actor, data)));

export const removeClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureDelete) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => deleteClosure(actor, data)));
