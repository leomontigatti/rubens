import { createServerFn } from "@tanstack/react-start";

import type { CoverageId, CoverageInput, CoverageUpdate } from "#/lib/coverages.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the roles for each call, so
// each validator here only names the type.

export const getCoverages = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listCoverages(caller, data)),
  );

export const addPatientCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.addCoverage(caller, data)),
  );

export const editCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateCoverage(caller, data)),
  );

export const changePrimaryCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageId) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.makeCoveragePrimary(caller, data)),
  );

export const deleteCoverage = createServerFn({ method: "POST" })
  .validator((data: CoverageId) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.removeCoverage(caller, data)),
  );
