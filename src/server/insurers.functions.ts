import { createServerFn } from "@tanstack/react-start";

import type { InsurerActiveChange, InsurerInput, InsurerUpdate } from "#/lib/coverages.ts";

import type { InsurerListOptions } from "#/organization/insurers.ts";
import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the admin role for a change, so
// each validator here only names the type.

export const getInsurers = createServerFn({ method: "GET" })
  .validator((data: InsurerListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) =>
      organization.listInsurers(caller, { includeInactive: data.includeInactive }),
    ),
  );

export const addInsurer = createServerFn({ method: "POST" })
  .validator((data: InsurerInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createInsurer(caller, data)),
  );

export const editInsurer = createServerFn({ method: "POST" })
  .validator((data: InsurerUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateInsurer(caller, data)),
  );

export const changeInsurerActive = createServerFn({ method: "POST" })
  .validator((data: InsurerActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setInsurerActive(caller, data)),
  );
