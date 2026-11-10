import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { formatPhone } from "#/lib/phones.ts";
import {
  getConversation,
  getOpenHandoffs,
  takeOverConversation,
} from "#/server/inbox.functions.ts";
import type { InboxMessage } from "#/organization/inbox.ts";
import type { ShownLateReply } from "#/organization/late-replies.ts";
import { Badge } from "#/components/ui/badge.tsx";

import {
  conversationName,
  messageSender,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { ConversationHandoffs } from "#/routes/_app/conversaciones/-handoffs.tsx";
import { ConversationHolder, useHoldAction } from "#/routes/_app/conversaciones/-hold.tsx";
import type { ReplyDraft } from "#/routes/_app/conversaciones/-hold.tsx";
import { StatusBadge, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// One conversation in the inbox, oldest message first, under its open
// handoffs and who answers it, where a member takes it over and replies. A
// message the member may not read shows that it exists, never its words. A
// reply the clinical check held goes to the reply's box to be sent or fixed.
// A reply written after the window closed follows the messages until the
// patient answers, or shows it never reached them.

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
    return <RefusalMessage message={refusalMessages[result.reason]} />;
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
        back={{ to: "/conversaciones", label: "Conversaciones" }}
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
      <ul className="flex flex-col divide-y rounded-xl border">
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
        {lateReplies.map((reply) => (
          <LateReplyRow key={reply.id} reply={reply} />
        ))}
      </ul>
    </div>
  );
}

const lateReplyLabels = {
  waiting: {
    badge: "En espera",
    hint: "Le enviamos al paciente la plantilla para reabrir la conversación. Le llega cuando responda.",
  },
  notDelivered: {
    badge: "No entregada",
    hint: "El paciente no respondió la plantilla para reabrir la conversación, así que no le llegó.",
  },
} as const;

function LateReplyRow({ reply }: { reply: ShownLateReply }) {
  const labels = lateReplyLabels[reply.state];
  return (
    <li className="flex flex-col gap-1 p-4 text-sm">
      <p className="text-muted-foreground flex items-center gap-2">
        <span className="text-foreground font-medium">{reply.writer}</span>
        {messageTime(reply.writtenAt)}
        <Badge variant={reply.state === "notDelivered" ? "destructive" : "secondary"}>
          {labels.badge}
        </Badge>
      </p>
      <p
        className={cn("whitespace-pre-wrap", reply.text === null && "text-muted-foreground italic")}
      >
        {reply.text ?? "Hay una respuesta clínica. Solo la leen los profesionales."}
      </p>
      <p className="text-muted-foreground">{labels.hint}</p>
    </li>
  );
}

function MessageRow({ message }: { message: InboxMessage }) {
  const sender = messageSender(message);
  return (
    <li className="flex flex-col gap-1 p-4 text-sm">
      <p className="text-muted-foreground flex items-center gap-2">
        <span className="text-foreground font-medium">{sender}</span>
        {messageTime(message.sentAt)}
        <StatusBadge message={message} />
      </p>
      <p
        className={cn(
          "whitespace-pre-wrap",
          message.withheld !== null && "text-muted-foreground italic",
        )}
      >
        {messageText(message)}
      </p>
    </li>
  );
}
