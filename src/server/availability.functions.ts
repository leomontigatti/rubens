import { createServerFn } from "@tanstack/react-start";

import type { AvailabilityQuery } from "#/lib/availability.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the query and decides whose free times the caller may
// read, so the validator here only names the type.

export const getAvailabilityPractitioners = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listAvailabilityPractitioners(caller)),
);

export const getFreeTimes = createServerFn({ method: "GET" })
  .validator((data: AvailabilityQuery) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getAvailability(caller, data)),
  );
