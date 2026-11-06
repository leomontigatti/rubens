import { createServerFn } from "@tanstack/react-start";

import type {
  ScheduleChange,
  ScheduleDelete,
  ScheduleEnd,
  ScheduleInput,
} from "#/lib/schedules.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input, requires an admin or a practitioner for a
// change and decides whose schedules the caller may change, so each validator
// here only names the type.

export const getSchedulePractitioners = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listSchedulePractitioners(caller)),
);

export const getSchedules = createServerFn({ method: "GET" })
  .validator((data: { practitionerId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getPractitionerSchedules(caller, data)),
  );

export const addSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createSchedule(caller, data)),
  );

export const editSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.changeSchedule(caller, data)),
  );

export const finishSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleEnd) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.endSchedule(caller, data)),
  );

export const removeSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleDelete) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.deleteSchedule(caller, data)),
  );
