import { createFileRoute } from "@tanstack/react-router";

import { answer, readBody, unauthenticated } from "../../../lib/http";
import { callerFrom } from "../../../lib/identity";
import { organizationObject } from "../../../lib/organization";
import { record } from "../../../lib/request-stats";
import { instant } from "../../../lib/week";

export const Route = createFileRoute("/api/appointments/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await callerFrom(request);
        if (!caller) return unauthenticated();
        const body = await readBody(request);
        const startsAt =
          body.startsAt !== undefined
            ? Number(body.startsAt)
            : instant(String(body.day), String(body.start));
        const endsAt =
          body.endsAt !== undefined
            ? Number(body.endsAt)
            : instant(String(body.day), String(body.end));
        const result = await organizationObject(caller.organizationId).book(caller, {
          patientId: String(body.patientId),
          practitionerId: String(body.practitionerId),
          roomId: String(body.roomId),
          startsAt,
          endsAt,
          overbooking: body.overbooking === true || body.overbooking === "1",
          remindInSeconds:
            body.remindInSeconds !== undefined && body.remindInSeconds !== ""
              ? Number(body.remindInSeconds)
              : undefined,
        });
        record(result.stats);
        return answer(request, body.back, result, 201);
      },
    },
  },
});
