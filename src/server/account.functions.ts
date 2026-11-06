import { createServerFn } from "@tanstack/react-start";

import { auth } from "#/lib/auth.ts";
import { passwordChangeSchema } from "#/lib/password-change.ts";

import { changeOwnPassword } from "#/server/accounts.ts";
import { withActor } from "#/server/with-actor.ts";
import { withOrganization } from "#/server/with-organization.ts";

// Both run for a member who must still change the starting password: the shell
// has to load to show them the form that clears it.
const signedIn = { roles: "any", passwordChange: "allowed" } as const;

/**
 * Who is signed in, from the organization's object. `mustChangePassword` comes
 * with Clerk's starting-password flag (#134); the dev sign-in has none.
 */
export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  withOrganization(async (organization, caller) => {
    const result = await organization.viewer(caller);
    if (!result.ok) {
      return result;
    }
    return { ok: true as const, viewer: { ...result.viewer, mustChangePassword: false } };
  }),
);

export const changePassword = createServerFn({ method: "POST" })
  .validator(passwordChangeSchema)
  .handler(({ data }) =>
    withActor(signedIn, (actor) => changeOwnPassword(auth, actor.userId, data)),
  );
