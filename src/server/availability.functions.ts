import { createServerFn } from "@tanstack/react-start";

import type { AvailabilityQuery } from "#/lib/availability.ts";

import { getAvailability, listAvailabilityPractitioners } from "#/server/availability.ts";
import { withActor } from "#/server/with-actor.ts";

// The service validates the query and decides whose free times the actor may
// read, so the validator here only names the type.
const anyRole = { roles: "any" } as const;

export const getAvailabilityPractitioners = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({
    ok: true as const,
    practitioners: await listAvailabilityPractitioners(actor),
  })),
);

export const getFreeTimes = createServerFn({ method: "GET" })
  .validator((data: AvailabilityQuery) => data)
  .handler(({ data }) => withActor(anyRole, (actor) => getAvailability(actor, data)));
