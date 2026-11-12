import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { formatPhone } from "#/lib/phones.ts";
import {
  getConversation,
  getOpenHandoffs,
  takeOverConversation,
} from "#/server/inbox.functions.ts";

import { ConversationChat } from "#/routes/_app/conversaciones/-chat.tsx";
import { registeredName } from "#/routes/_app/conversaciones/-labels.ts";
import {
  HandoffActions,
  HandoffBadges,
  HandoffDescription,
  HeldReplies,
} from "#/routes/_app/conversaciones/-handoffs.tsx";
import {
  HoldActions,
  HoldBadge,
  ReplyBox,
  useHoldAction,
} from "#/routes/_app/conversaciones/-hold.tsx";
import type { ReplyDraft } from "#/routes/_app/conversaciones/-hold.tsx";
import { refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// One conversation in the inbox as a WhatsApp chat (`-chat.tsx`), with who
// answers it and its open handoffs beside its title, where a member takes it
// over, closes a handoff and replies. A reply the clinical check held goes to
// the reply's box to be sent or fixed, by a practitioner who keeps clinical
// records.

const backToInbox = { to: "/conversaciones", label: "Conversaciones" } as const;

export const Route = createFileRoute("/_app/conversaciones/$conversationId")({
  loader: async ({ params }) => {
    const data = { conversationId: params.conversationId };
    const [conversation, handoffs] = await Promise.all([
      getConversation({ data }),
      getOpenHandoffs({ data }),
    ]);
    return { conversation, handoffs };
  },
  head: () => ({ meta: [{ title: "Conversación · underthing" }] }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversation: result, handoffs } = Route.useLoaderData();
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const action = useHoldAction();

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={backToInbox} title="Conversación" />
        <ErrorAlert message={refusalMessages[result.reason]} />
      </div>
    );
  }
  const { conversation, messages, hold, window, lateReplies, queuedReopen, withdrawnReplies } =
    result;
  const open = handoffs.ok ? handoffs.handoffs : [];
  // Offered only while an open handoff of this conversation still holds the
  // reply: once sent, dropped or its handoff closed, it never comes back.
  const stillHeld = open.some((handoff) => handoff.heldReply === draft?.text);
  const liveDraft = draft?.conversationId === conversation.id && stillHeld ? draft : null;

  /** Takes the conversation over when the member does not hold it, then puts `text` in the reply's box. */
  async function putInReply(text: string) {
    const data = { conversationId: conversation.id };
    if (
      !hold?.mine &&
      !(await action.run("take-over-conversation", () => takeOverConversation({ data })))
    ) {
      return;
    }
    setDraft({ id: Date.now(), conversationId: conversation.id, text });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={backToInbox}
        title={registeredName(conversation) ?? "Sin registrar"}
        status={
          <>
            <HoldBadge hold={hold} />
            <HandoffBadges handoffs={open} />
          </>
        }
        description={<HandoffDescription phone={formatPhone(conversation.phone)} handoffs={open} />}
        actions={
          <>
            <HandoffActions handoffs={open} />
            <HoldActions conversationId={conversation.id} hold={hold} />
          </>
        }
      />
      <HeldReplies handoffs={open} onUseReply={(text) => void putInReply(text)} />
      <ConversationChat
        conversationId={conversation.id}
        messages={messages}
        queuedReopen={queuedReopen}
        lateReplies={lateReplies}
        withdrawnReplies={withdrawnReplies}
      />
      {/* Keyed, so a draft never follows a navigation to another conversation. */}
      <ReplyBox
        key={conversation.id}
        conversationId={conversation.id}
        hold={hold}
        window={window}
        draft={liveDraft}
        // A practitioner answering what was handed to them is told reception reads it too.
        readByReception={open.some((handoff) => handoff.forPractitioner && handoff.mayAnswer)}
      />
    </div>
  );
}
