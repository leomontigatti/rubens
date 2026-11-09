import { createServerFn } from "@tanstack/react-start";

import type { HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";
import type { ConversationListOptions, ConversationReference } from "#/lib/whatsapp-messages.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The inbox (ui: "Conversaciones"). The object validates the input and
// decides, per role, which conversations and which messages' words the
// member reads (`src/organization/inbox.ts`), so each validator here only
// names the type.

export const getConversations = createServerFn({ method: "GET" })
  .validator((data: Pick<ConversationListOptions, "page">) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listConversations(caller, data)),
  );

// A POST, so the search text travels in the body and stays out of URLs.
export const findConversations = createServerFn({ method: "POST" })
  .validator((data: ConversationListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listConversations(caller, data)),
  );

export const getConversation = createServerFn({ method: "GET" })
  .validator((data: ConversationReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.readConversation(caller, data)),
  );

// The open handoffs the member sees (`src/organization/handoff-inbox.ts`).
export const getOpenHandoffs = createServerFn({ method: "GET" })
  .validator((data: OpenHandoffListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listOpenHandoffs(caller, data)),
  );

export const closeHandoff = createServerFn({ method: "POST" })
  .validator((data: HandoffReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.closeHandoff(caller, data)),
  );
