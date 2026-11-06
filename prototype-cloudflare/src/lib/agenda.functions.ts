import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { callerFrom } from "./identity";
import { organizationObject } from "./organization";
import { record } from "./request-stats";
import { weekBounds } from "./week";

export const getAgenda = createServerFn({ method: "GET" })
  .validator((data: { week: string; office?: string }) => data)
  .handler(async ({ data }) => {
    const caller = await callerFrom(getRequest());
    if (!caller) throw redirect({ to: "/ingresar" });
    const result = await organizationObject(caller.organizationId).agenda(caller, {
      officeId: data.office,
      ...weekBounds(data.week),
    });
    record(result.stats);
    return { caller, ...result };
  });
