import handler from "@tanstack/react-start/server-entry";

import { authMode } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";

export { Organization } from "#/organization/organization.ts";

// The Worker: Start's handler, behind the check that refuses to serve a
// deployed Worker with no Clerk secret (`authMode`).
export default {
  fetch(request: Request, env: WorkerEnv) {
    authMode(env, import.meta.env.DEV);
    return handler.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
