import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { formatPhone } from "#/lib/phones.ts";
import { getConversation } from "#/server/inbox.functions.ts";
import type { InboxMessage } from "#/organization/inbox.ts";

import {
  conversationName,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { StatusBadge, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// One conversation in the inbox, oldest message first, read only. A message
// the member may not read shows that it exists, never its words.

export const Route = createFileRoute("/_app/conversaciones/$conversationId")({
  loader: ({ params }) => getConversation({ data: { conversationId: params.conversationId } }),
  head: () => ({ meta: [{ title: "Conversación · underthing" }] }),
  component: ConversationPage,
});

function ConversationPage() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const { conversation, messages } = result;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: "/conversaciones", label: "Conversaciones" }}
        title={conversationName(conversation)}
        description={formatPhone(conversation.phone)}
      />
      <ul className="flex flex-col divide-y rounded-xl border">
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ message }: { message: InboxMessage }) {
  const sender =
    message.direction === "incoming"
      ? "Paciente"
      : message.type === "template"
        ? "Plantilla"
        : "Consultorio";
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
