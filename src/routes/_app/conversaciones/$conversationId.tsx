import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { PatientBubble, WhatsappBubble, WhatsappChat } from "#/components/whatsapp-bubble.tsx";
import { formatPhone } from "#/lib/phones.ts";
import {
  getConversation,
  getOpenHandoffs,
  takeOverConversation,
} from "#/server/inbox.functions.ts";
import type { InboxMessage } from "#/organization/inbox.ts";

import {
  conversationName,
  messageSender,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { ConversationHandoffs } from "#/routes/_app/conversaciones/-handoffs.tsx";
import { ConversationHolder, useHoldAction } from "#/routes/_app/conversaciones/-hold.tsx";
import { LateReplyBubble } from "#/routes/_app/conversaciones/-late-replies.tsx";
import type { ReplyDraft } from "#/routes/_app/conversaciones/-hold.tsx";
import { StatusBadge, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// One conversation in the inbox as a WhatsApp chat, oldest message first, the
// patient's on one side and the clinic's on the other, under its open
// handoffs and who answers it, where a member takes it over and replies. A
// message the member may not read shows that it exists, never its words. A
// reply the clinical check held goes to the reply's box to be sent or fixed.
// A reply written after the window closed follows the messages until the
// patient answers, or its writer withdraws it, or shows it never reached them.

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
  const { conversation, messages, hold, window, lateReplies } = result;
  // Offered only while an open handoff of this conversation still holds the
  // reply: once sent, dropped or its handoff closed, it never comes back.
  const stillHeld =
    handoffs.ok && handoffs.handoffs.some((handoff) => handoff.heldReply === draft?.text);
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
        title={conversationName(conversation)}
        description={formatPhone(conversation.phone)}
      />
      {handoffs.ok && (
        <ConversationHandoffs
          handoffs={handoffs.handoffs}
          onUseReply={(text) => void putInReply(text)}
        />
      )}
      {/* Keyed, so a draft never follows a navigation to another conversation. */}
      <ConversationHolder
        key={conversation.id}
        conversationId={conversation.id}
        hold={hold}
        window={window}
        draft={liveDraft}
      />
      <WhatsappChat label="Mensajes">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {lateReplies.map((reply) => (
          <LateReplyBubble key={reply.id} reply={reply} />
        ))}
      </WhatsappChat>
    </div>
  );
}

function MessageBubble({ message }: { message: InboxMessage }) {
  const text = (
    <span className={cn(message.withheld !== null && "text-muted-foreground italic")}>
      {messageText(message)}
    </span>
  );
  const footer = (
    <>
      {messageTime(message.sentAt)}
      <StatusBadge message={message} />
    </>
  );
  const sender = messageSender(message);
  return sender === null ? (
    <PatientBubble footer={footer}>{text}</PatientBubble>
  ) : (
    <WhatsappBubble author={sender} footer={footer}>
      {text}
    </WhatsappBubble>
  );
}
