import { createServerFn } from "@tanstack/react-start";

import type {
  ScheduleChange,
  ScheduleDelete,
  ScheduleEnd,
  ScheduleInput,
} from "#/lib/schedules.ts";

import {
  changeSchedule,
  createSchedule,
  deleteSchedule,
  endSchedule,
  getPractitionerSchedules,
  listSchedulePractitioners,
} from "#/server/schedules.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide whose schedules the actor may
// change, so each validator here only names the type. Requiring an admin or a
// practitioner refuses a receptionist before a transaction opens.
const anyRole = { roles: "any" } as const;
const editors = { roles: ["admin", "practitioner"] } as const;

export const getSchedulePractitioners = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({
    ok: true as const,
    practitioners: await listSchedulePractitioners(actor),
  })),
);

export const getSchedules = createServerFn({ method: "GET" })
  .validator((data: { practitionerId: string }) => data)
  .handler(({ data }) => withActor(anyRole, (actor) => getPractitionerSchedules(actor, data)));

export const addSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => createSchedule(actor, data)));

export const editSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleChange) => data)
  .handler(({ data }) => withActor(editors, (actor) => changeSchedule(actor, data)));

export const finishSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleEnd) => data)
  .handler(({ data }) => withActor(editors, (actor) => endSchedule(actor, data)));

export const removeSchedule = createServerFn({ method: "POST" })
  .validator((data: ScheduleDelete) => data)
  .handler(({ data }) => withActor(editors, (actor) => deleteSchedule(actor, data)));
