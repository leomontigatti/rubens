import { createServerFn } from "@tanstack/react-start";

import type { TimeOffDelete, TimeOffInput, TimeOffUpdate } from "#/lib/time-ranges.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input, requires an admin or a practitioner for a
// change and decides whose time off the caller may change, so each validator
// here only names the type.

export const getTimeOff = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listTimeOff(caller)),
);

export const addTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createTimeOff(caller, data)),
  );

export const editTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateTimeOff(caller, data)),
  );

export const removeTimeOff = createServerFn({ method: "POST" })
  .validator((data: TimeOffDelete) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.deleteTimeOff(caller, data)),
  );
