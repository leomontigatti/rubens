import { createServerFn } from "@tanstack/react-start";

import type {
  AppointmentTypeActiveChange,
  AppointmentTypeInput,
  AppointmentTypeUpdate,
} from "#/lib/appointment-types.ts";

import {
  createAppointmentType,
  listAppointmentTypes,
  setAppointmentTypeActive,
  updateAppointmentType,
} from "#/server/appointment-types.ts";
import type { AppointmentTypeListOptions } from "#/server/appointment-types.ts";
import { listSchedulePractitioners } from "#/server/schedules.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide whose types the actor may
// change, so each validator here only names the type. Requiring an admin or a
// practitioner refuses a receptionist before a transaction opens.
const anyRole = { roles: "any" } as const;
const editors = { roles: ["admin", "practitioner"] } as const;

export const getAppointmentTypePractitioners = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({
    ok: true as const,
    practitioners: await listSchedulePractitioners(actor),
  })),
);

export const getAppointmentTypes = createServerFn({ method: "GET" })
  .validator((data: AppointmentTypeListOptions) => data)
  .handler(({ data }) => withActor(anyRole, (actor) => listAppointmentTypes(actor, data)));

export const addAppointmentType = createServerFn({ method: "POST" })
  .validator((data: AppointmentTypeInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => createAppointmentType(actor, data)));

export const editAppointmentType = createServerFn({ method: "POST" })
  .validator((data: AppointmentTypeUpdate) => data)
  .handler(({ data }) => withActor(editors, (actor) => updateAppointmentType(actor, data)));

export const changeAppointmentTypeActive = createServerFn({ method: "POST" })
  .validator((data: AppointmentTypeActiveChange) => data)
  .handler(({ data }) => withActor(editors, (actor) => setAppointmentTypeActive(actor, data)));
