import { createFileRoute } from "@tanstack/react-router";

import { unauthenticated } from "../../../lib/http";
import { callerFrom, organizationObject } from "../../../lib/organization";

export const Route = createFileRoute("/api/appointments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const caller = await callerFrom(request.headers);
        if (!caller) return unauthenticated();
        return Response.json(
          await organizationObject(caller.organizationId).getAppointment(caller, params.id),
        );
      },
    },
  },
});
