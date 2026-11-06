import { createServerFn } from "@tanstack/react-start";

import type { ClosureDelete, ClosureInput, ClosureUpdate } from "#/lib/time-ranges.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the admin role for a change, so
// each validator here only names the type. Everyone reads closures.

export const getClosures = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listClosures(caller)),
);

export const addClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createClosure(caller, data)),
  );

export const editClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateClosure(caller, data)),
  );

export const removeClosure = createServerFn({ method: "POST" })
  .validator((data: ClosureDelete) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.deleteClosure(caller, data)),
  );
