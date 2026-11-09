import { MessagesSquareIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useServerDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { useDebounced } from "#/components/use-debounced.ts";
import { formatPhone } from "#/lib/phones.ts";
import { conversationPageSize } from "#/lib/whatsapp-messages.ts";
import { findConversations, getConversations } from "#/server/inbox.functions.ts";
import type { ConversationSummary } from "#/organization/inbox.ts";

import {
  conversationName,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { StatusBadge, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// The inbox (ui: "Conversaciones"): the WhatsApp conversations the member
// reads, latest first, a page at a time. Which ones, and which messages'
// words, the object decides by role (docs/domain/assistant.md § Inbox).

export const Route = createFileRoute("/_app/conversaciones/")({
  head: () => ({ meta: [{ title: "Conversaciones · underthing" }] }),
  // The search text stays out of the address: a URL ends up in proxy logs and
  // the browser's history, and patient data must not.
  validateSearch: z.object({
    pagina: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ page: search.pagina }),
  loader: ({ deps }) => getConversations({ data: deps }),
  component: Conversations,
});

const searchDelay = 300;

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
  { id: "at", header: "Fecha", cell: ({ lastMessage }) => messageTime(lastMessage.sentAt) },
];

/**
 * The conversations matching what is typed, asked for once typing pauses;
 * only the answer to the text in the box is shown.
 */
function useConversationSearch(typed: string) {
  const { viewer } = Route.useRouteContext();
  const asked = useDebounced(typed.trim(), searchDelay);
  const answer = useQuery({
    queryKey: ["conversation-search", viewer.organizationId, viewer.userId, asked],
    queryFn: () => findConversations({ data: { query: asked } }),
    enabled: asked !== "",
  });
  const searching = typed.trim() !== "";
  const settled = searching && asked === typed.trim() ? answer.data : undefined;
  return {
    searching,
    waiting: searching && settled === undefined && !answer.isError,
    found: settled?.ok ? settled : null,
    refused: settled && !settled.ok ? settled.reason : null,
  };
}

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
      <ConversationTable listed={result} />
    </div>
  );
}

function ConversationTable(props: {
  listed: { conversations: ConversationSummary[]; total: number; page: number };
}) {
  const { listed } = props;
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const search = useConversationSearch(query);
  const shown = search.searching ? (search.found?.conversations ?? []) : listed.conversations;
  const table = useServerDataTable({
    rows: shown,
    columns,
    getRowId: (conversation) => conversation.id,
  });
  const pager = {
    page: listed.page,
    pageCount: Math.ceil(listed.total / conversationPageSize),
    total: listed.total,
    onPageChange: (pagina: number) =>
      void navigate({ search: (previous) => ({ ...previous, pagina }) }),
  };
  const more =
    search.found && search.found.total > search.found.conversations.length
      ? `Se muestran las ${search.found.conversations.length} conversaciones más recientes de ${search.found.total}. Escribí más para acotar la búsqueda.`
      : null;
  return (
    <div className="flex flex-col gap-3 has-data-[slot=empty]:flex-1">
      <DataTable
        table={table}
        search={{
          value: query,
          onChange: setQuery,
          label: "Buscar conversación",
          placeholder: "Buscar por paciente o teléfono",
          loading: search.waiting,
        }}
        pager={search.searching ? undefined : pager}
        noRecords={!search.searching && listed.total === 0}
        empty={
          search.refused ? (
            <ErrorAlert message={refusalMessages[search.refused]} />
          ) : search.searching ? (
            search.found && <NoMatches icon={MessagesSquareIcon} />
          ) : (
            <EmptyState
              icon={MessagesSquareIcon}
              title="Sin conversaciones"
              description="Todavía no hay conversaciones de WhatsApp."
            />
          )
        }
      />
      {more && <p className="text-muted-foreground text-sm">{more}</p>}
    </div>
  );
}
