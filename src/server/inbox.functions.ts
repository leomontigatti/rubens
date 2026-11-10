import { createServerFn } from "@tanstack/react-start";

import type { LateReplyReference, PersonalReply } from "#/lib/conversation-holds.ts";
import type { HandoffReference, OpenHandoffListOptions, OptOutReport } from "#/lib/handoffs.ts";
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

export const dropHeldReply = createServerFn({ method: "POST" })
  .validator((data: HandoffReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.dropHeldReply(caller, data)),
  );

// An opt-out a practitioner read among words the model could not read.
export const reportOptOut = createServerFn({ method: "POST" })
  .validator((data: OptOutReport) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.reportOptOut(caller, data)),
  );

// Taking a conversation over, replying under one's name and giving it back
// (`src/organization/conversation-holds.ts`).
export const takeOverConversation = createServerFn({ method: "POST" })
  .validator((data: ConversationReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.takeOverConversation(caller, data)),
  );

export const replyToConversation = createServerFn({ method: "POST" })
  .validator((data: PersonalReply) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.replyToConversation(caller, data)),
  );

export const returnConversation = createServerFn({ method: "POST" })
  .validator((data: ConversationReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.returnConversation(caller, data)),
  );

// A reply written after the window closed, withdrawn by its writer while it waits (`src/organization/late-replies.ts`).
export const withdrawLateReply = createServerFn({ method: "POST" })
  .validator((data: LateReplyReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.withdrawLateReply(caller, data)),
  );
