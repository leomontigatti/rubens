import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { callerFrom, organizationObject } from "./organization";
import { record } from "./request-stats";
import { weekBounds } from "./week";

export const getAgenda = createServerFn({ method: "GET" })
  .validator((data: { week: string; office?: string }) => data)
  .handler(async ({ data }) => {
    const caller = await callerFrom(getRequestHeaders() as unknown as Headers);
    if (!caller) throw redirect({ to: "/ingresar" });
    const result = await organizationObject(caller.organizationId).agenda(caller, {
      officeId: data.office,
      ...weekBounds(data.week),
    });
    record(result.stats);
    return { caller, ...result };
  });
