import { createServerFn } from "@tanstack/react-start";

import type { CoverageId, CoverageInput, CoverageUpdate } from "#/lib/coverages.ts";

import {
  addCoverage,
  listCoverages,
  makeCoveragePrimary,
  removeCoverage,
  updateCoverage,
} from "#/server/coverages.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and check the actor's roles themselves, so
// each validator here only names the type. Naming the roles here as well
// refuses a call before it opens a transaction.
const editors = { roles: ["admin", "receptionist", "practitioner"] } as const;

export const getCoverages = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) => withActor(editors, (actor) => listCoverages(actor, data)));

export const addPatientCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => addCoverage(actor, data)));

export const editCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageUpdate) => data)
  .handler(({ data }) => withActor(editors, (actor) => updateCoverage(actor, data)));

export const changePrimaryCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageId) => data)
  .handler(({ data }) => withActor(editors, (actor) => makeCoveragePrimary(actor, data)));

export const deleteCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageId) => data)
  .handler(({ data }) => withActor(editors, (actor) => removeCoverage(actor, data)));
