import handler from "@tanstack/react-start/server-entry";

import { authMode, serveClerkPageLoad } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";

export { Organization } from "#/organization/organization.ts";
export { WhatsappDirectory } from "#/server/whatsapp-directory.ts";

// The Worker: Start's handler, behind the check that refuses to serve a
// deployed Worker with no Clerk secret (`authMode`). With Clerk, a page load
// whose session token expired is first sent through Clerk's handshake, which
// refreshes it and comes back, so the page is not rendered as signed out, and
// a page Clerk refreshed the session for carries the new cookies.
export default {
  fetch(request: Request, env: WorkerEnv) {
    if (authMode(env, import.meta.env.DEV) === "clerk") {
      return serveClerkPageLoad(request, env, (served) => handler.fetch(served));
    }
    return handler.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
