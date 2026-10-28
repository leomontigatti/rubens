import { createServerFn } from "@tanstack/react-start";

import type { InsurerActiveChange, InsurerInput, InsurerUpdate } from "#/lib/coverages.ts";

import { createInsurer, listInsurers, setInsurerActive, updateInsurer } from "#/server/insurers.ts";
import type { InsurerListOptions } from "#/server/insurers.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and check the actor's roles themselves, so
// each validator here only names the type. Naming the roles here as well
// refuses a call before it opens a transaction.
const editors = { roles: ["admin", "receptionist", "practitioner"] } as const;
const adminOnly = { roles: ["admin"] } as const;

export const getInsurers = createServerFn({ method: "GET" })
  .validator((data: InsurerListOptions) => data)
  .handler(({ data }) =>
    withActor(editors, (actor) => listInsurers(actor, { includeInactive: data.includeInactive })),
  );

export const addInsurer = createServerFn({ method: "POST" })
  .validator((data: InsurerInput) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => createInsurer(actor, data)));

export const editInsurer = createServerFn({ method: "POST" })
  .validator((data: InsurerUpdate) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => updateInsurer(actor, data)));

export const changeInsurerActive = createServerFn({ method: "POST" })
  .validator((data: InsurerActiveChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setInsurerActive(actor, data)));
