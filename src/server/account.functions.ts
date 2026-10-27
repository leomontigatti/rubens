import { createServerFn } from "@tanstack/react-start";

import { auth } from "#/lib/auth.ts";
import { passwordChangeSchema } from "#/lib/password-change.ts";

import { changeOwnPassword } from "./accounts.ts";
import { loadViewer } from "./viewer.ts";
import { withActor } from "./with-actor.ts";

// Both run for a member who must still change the starting password: the shell
// has to load to show them the form that clears it.
const signedIn = { roles: "any", passwordChange: "allowed" } as const;

export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  withActor(signedIn, async (actor) => ({
    ok: true as const,
    viewer: await loadViewer(auth, actor),
  })),
);

export const changePassword = createServerFn({ method: "POST" })
  .validator(passwordChangeSchema)
  .handler(({ data }) =>
    withActor(signedIn, (actor) => changeOwnPassword(auth, actor.userId, data)),
  );
