import { createFileRoute } from "@tanstack/react-router";

import { answer, readBody, unauthenticated } from "../../lib/http";
import { callerFrom, organizationObject } from "../../lib/organization";

export const Route = createFileRoute("/api/rooms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await callerFrom(request.headers);
        if (!caller) return unauthenticated();
        const body = await readBody(request);
        const result = await organizationObject(caller.organizationId).createRoom(caller, {
          officeId: String(body.officeId),
          name: String(body.name),
          capacity: Number(body.capacity ?? 1),
        });
        return answer(request, body.back, result, 201);
      },
    },
  },
});
