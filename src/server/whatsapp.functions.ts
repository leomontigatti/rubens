import { createServerFn } from "@tanstack/react-start";

import type { SandboxStart, SandboxTurnInput } from "#/lib/assistant-sandbox.ts";
import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import type { ReturnTimeInput } from "#/lib/conversation-holds.ts";
import type { HandoffContactsInput } from "#/lib/handoff-contacts.ts";
import type { HandoffRemindersInput } from "#/lib/handoffs.ts";
import type { SignupCompletion } from "#/lib/whatsapp.ts";
import type {
  TemplateCreate,
  TemplateDelete,
  TemplateEdit,
  TemplateReviewRequest,
} from "#/lib/whatsapp-templates.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the admin role, so each
// validator here only names the type.

export const getWhatsappSettings = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.whatsappSettings(caller)),
);

export const createTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateCreate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createTemplate(caller, data)),
  );

export const editTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateEdit) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.editTemplate(caller, data)),
  );

export const deleteTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateDelete) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.deleteTemplate(caller, data)),
  );

export const reviewTemplate = createServerFn({ method: "POST" })
  .validator((data: TemplateReviewRequest) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.reviewTemplate(caller, data)),
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

export const getHandoffContacts = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.handoffContacts(caller)),
);

export const saveHandoffContacts = createServerFn({ method: "POST" })
  .validator((data: HandoffContactsInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.saveHandoffContacts(caller, data)),
  );

// How long a member holds a conversation they took over before it goes back to the assistant.
export const saveReturnTime = createServerFn({ method: "POST" })
  .validator((data: ReturnTimeInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.saveReturnTime(caller, data)),
  );

// How many hours before the window closes a handoff's reminders go.
export const saveHandoffReminders = createServerFn({ method: "POST" })
  .validator((data: HandoffRemindersInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.saveHandoffReminders(caller, data)),
  );

export const getSandboxScenarios = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.sandboxScenarios(caller)),
);

export const startSandbox = createServerFn({ method: "POST" })
  .validator((data: SandboxStart) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.startSandbox(caller, data)),
  );

export const playSandboxTurn = createServerFn({ method: "POST" })
  .validator((data: SandboxTurnInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.sandboxTurn(caller, data)),
  );
