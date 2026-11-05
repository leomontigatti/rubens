import { createFileRoute } from "@tanstack/react-router";

import { unauthenticated } from "../../../lib/http";
import { callerFrom, organizationObject } from "../../../lib/organization";

export const Route = createFileRoute("/api/appointments/counts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await callerFrom(request.headers);
        if (!caller) return unauthenticated();
        return Response.json(
          await organizationObject(caller.organizationId).countAppointments(caller),
        );
      },
    },
  },
});
