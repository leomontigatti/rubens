import { MessagesSquareIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { formatPhone } from "#/lib/phones.ts";
import { getConversations } from "#/server/inbox.functions.ts";
import type { ConversationSummary } from "#/organization/inbox.ts";

import {
  StatusBadge,
  conversationName,
  messageText,
  messageTime,
  refusalMessages,
} from "#/routes/_app/conversaciones/-messages.tsx";

// The inbox (ui: "Conversaciones"): the WhatsApp conversations the member
// reads, latest first. Which ones, and which messages' words, the object
// decides by role (docs/domain/assistant.md § Inbox).

export const Route = createFileRoute("/_app/conversaciones/")({
  head: () => ({ meta: [{ title: "Conversaciones · underthing" }] }),
  loader: () => getConversations(),
  component: Conversations,
});

const columns: DataTableColumn<ConversationSummary>[] = [
  {
    id: "name",
    header: "Contacto",
    cell: (conversation) => (
      <RowLink to="/conversaciones/$conversationId" params={{ conversationId: conversation.id }}>
        {conversationName(conversation)}
      </RowLink>
    ),
  },
  { id: "phone", header: "Teléfono", cell: (conversation) => formatPhone(conversation.phone) },
  {
    id: "last",
    header: "Último mensaje",
    cell: ({ lastMessage }) => (
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground max-w-md truncate">{messageText(lastMessage)}</span>
        <StatusBadge message={lastMessage} />
      </span>
    ),
  },
  {
    id: "at",
    header: "Fecha",
    cell: ({ lastMessage }) => messageTime(lastMessage.sentAt),
  },
];

function Conversations() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Conversaciones"
        description="Los mensajes de WhatsApp con los pacientes."
      />
      <ConversationTable conversations={result.conversations} />
    </div>
  );
}

function ConversationTable({ conversations }: { conversations: ConversationSummary[] }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: conversations,
    columns,
    getRowId: (conversation) => conversation.id,
    searchText: (conversation) =>
      `${conversationName(conversation)} ${formatPhone(conversation.phone)} ${conversation.phone}`,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar conversación",
        placeholder: "Buscar por paciente o teléfono",
      }}
      noRecords={conversations.length === 0}
      empty={
        conversations.length === 0 ? (
          <EmptyState
            icon={MessagesSquareIcon}
            title="Sin conversaciones"
            description="Todavía no hay conversaciones de WhatsApp."
          />
        ) : (
          <NoMatches icon={MessagesSquareIcon} />
        )
      }
    />
  );
}
