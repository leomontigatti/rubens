import { createFileRoute } from "@tanstack/react-router";

import { handleSetupRequest } from "#/server/organization-setup.ts";
import { workerEnv } from "#/server/with-organization.ts";

export const Route = createFileRoute("/api/setup")({
  server: {
    handlers: {
      POST: ({ request }) => handleSetupRequest(request, workerEnv),
    },
  },
});
