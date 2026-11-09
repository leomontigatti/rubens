import { createServerFn } from "@tanstack/react-start";

import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import type { SignupCompletion, TemplateSend } from "#/lib/whatsapp.ts";
import type { TemplateSubmission } from "#/lib/whatsapp-templates.ts";

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

export const submitWhatsappTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateSubmission) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.submitWhatsappTemplate(caller, data)),
  );

export const refreshWhatsappTemplates = createServerFn({ method: "POST" }).handler(() =>
  withOrganization((organization, caller) => organization.refreshWhatsappTemplates(caller)),
);

export const connectWhatsapp = createServerFn({ method: "POST" })
  .validator((data: SignupCompletion) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.connectWhatsapp(caller, data)),
  );

export const disconnectWhatsapp = createServerFn({ method: "POST" }).handler(() =>
  withOrganization((organization, caller) => organization.disconnectWhatsapp(caller)),
);

export const saveCommunicationRules = createServerFn({ method: "POST" })
  .validator((data: CommunicationRulesInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.saveCommunicationRules(caller, data)),
  );
