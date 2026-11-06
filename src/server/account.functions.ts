import { createServerFn } from "@tanstack/react-start";

import { passwordChangeSchema } from "#/lib/password-change.ts";

import { withOrganization } from "#/server/with-organization.ts";

// Both serve a member who must still replace the starting password: the shell
// has to load to show them the form that clears it.

/** Who is signed in, from the organization's object, with their starting-password hold. */
export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.viewer(caller)),
);

export const changePassword = createServerFn({ method: "POST" })
  .validator(passwordChangeSchema)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.changePassword(caller, data)),
  );
