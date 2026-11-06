import handler from "@tanstack/react-start/server-entry";

import { authMode, clerkPageLoadRedirect } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";

export { Organization } from "#/organization/organization.ts";

// The Worker: Start's handler, behind the check that refuses to serve a
// deployed Worker with no Clerk secret (`authMode`). With Clerk, a page load
// whose session token expired is first sent through Clerk's handshake, which
// refreshes it and comes back, so the page is not rendered as signed out.
export default {
  async fetch(request: Request, env: WorkerEnv) {
    if (authMode(env, import.meta.env.DEV) === "clerk") {
      const redirect = await clerkPageLoadRedirect(request, env);
      if (redirect) {
        return redirect;
      }
    }
    return handler.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
