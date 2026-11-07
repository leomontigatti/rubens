import { createServerFn } from "@tanstack/react-start";

import type { TemplateSend } from "#/lib/whatsapp.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the admin role, so each
// validator here only names the type.

export const getWhatsappSettings = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.whatsappSettings(caller)),
);

export const sendWhatsappTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateSend) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.sendWhatsappTemplate(caller, data)),
  );
