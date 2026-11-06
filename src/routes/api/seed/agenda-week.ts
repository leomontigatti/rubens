import { createFileRoute } from "@tanstack/react-router";

import { handleAgendaWeekSeed } from "#/server/agenda-week-seed.ts";
import { workerEnv } from "#/server/with-organization.ts";

export const Route = createFileRoute("/api/seed/agenda-week")({
  server: {
    handlers: {
      POST: ({ request }) => handleAgendaWeekSeed(request, workerEnv, import.meta.env.DEV),
    },
  },
});
