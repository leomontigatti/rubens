import { createServerFn } from "@tanstack/react-start";

import type { ConversationReference } from "#/lib/whatsapp-messages.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The inbox (ui: "Conversaciones"). The object validates the input and
// decides, per role, which conversations and which messages' words the
// member reads (`src/organization/inbox.ts`), so each validator here only
// names the type.

export const getConversations = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listConversations(caller)),
);

export const getConversation = createServerFn({ method: "GET" })
  .validator((data: ConversationReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.readConversation(caller, data)),
  );
