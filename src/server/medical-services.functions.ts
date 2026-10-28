import { createServerFn } from "@tanstack/react-start";

import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";

import {
  createMedicalService,
  listMedicalServices,
  setMedicalServiceActive,
  updateMedicalService,
} from "#/server/medical-services.ts";
import type { MedicalServiceListOptions } from "#/server/medical-services.ts";
import { listSchedulePractitioners } from "#/server/schedules.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide whose types the actor may
// change, so each validator here only names the type. Requiring an admin or a
// practitioner refuses a receptionist before a transaction opens.
const anyRole = { roles: "any" } as const;
const editors = { roles: ["admin", "practitioner"] } as const;

export const getMedicalServicePractitioners = createServerFn({ method: "GET" }).handler(() =>
  withActor(anyRole, async (actor) => ({
    ok: true as const,
    practitioners: await listSchedulePractitioners(actor),
  })),
);

export const getMedicalServices = createServerFn({ method: "GET" })
  .validator((data: MedicalServiceListOptions) => data)
  .handler(({ data }) => withActor(anyRole, (actor) => listMedicalServices(actor, data)));

export const addMedicalService = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => createMedicalService(actor, data)));

export const editMedicalService = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceUpdate) => data)
  .handler(({ data }) => withActor(editors, (actor) => updateMedicalService(actor, data)));

export const changeMedicalServiceActive = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceActiveChange) => data)
  .handler(({ data }) => withActor(editors, (actor) => setMedicalServiceActive(actor, data)));
