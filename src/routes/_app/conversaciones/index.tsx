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
import { findConversations, getConversations, getOpenHandoffs } from "#/server/inbox.functions.ts";
import type { ConversationSummary } from "#/organization/inbox.ts";

import { messageText, messageTime, registeredName } from "#/routes/_app/conversaciones/-labels.ts";
import { OpenHandoffList } from "#/routes/_app/conversaciones/-handoffs.tsx";
import { MessageStatus, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// The inbox (ui: "Conversaciones"): the open handoffs, then the WhatsApp
// conversations the member reads, latest first, a page at a time. Which ones, and which messages'
// words, the object decides by role (docs/domain/assistant.md § Inbox).

export const Route = createFileRoute("/_app/conversaciones/")({
  head: () => ({ meta: [{ title: "Conversaciones · underthing" }] }),
  // The search text stays out of the address: a URL ends up in proxy logs and
  // the browser's history, and patient data must not.
  validateSearch: z.object({
    pagina: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ page: search.pagina }),
  loader: async ({ deps }) => {
    const [conversations, handoffs] = await Promise.all([
      getConversations({ data: deps }),
      getOpenHandoffs({ data: {} }),
    ]);
    return { conversations, handoffs };
  },
  component: Conversations,
});

const searchDelay = 300;

const searchRefusalMessages = {
  ...refusalMessages,
  invalidInput: "La búsqueda es demasiado larga. Escribí menos para buscar.",
};

function ConversationLink(props: { conversationId: string; children: string }) {
  return (
    <RowLink to="/conversaciones/$conversationId" params={{ conversationId: props.conversationId }}>
      {props.children}
    </RowLink>
  );
}

// A number that stands for no patient is named by its phone, so the phone
// opens its conversation.
const columns: DataTableColumn<ConversationSummary>[] = [
  {
    id: "name",
    header: "Contacto",
    cell: (conversation) => {
      const name = registeredName(conversation);
      return name === null ? (
        <span className="text-muted-foreground">Sin registrar</span>
      ) : (
        <ConversationLink conversationId={conversation.id}>{name}</ConversationLink>
      );
    },
  },
  {
    id: "phone",
    header: "Teléfono",
    cell: (conversation) =>
      registeredName(conversation) === null ? (
        <ConversationLink conversationId={conversation.id}>
          {formatPhone(conversation.phone)}
        </ConversationLink>
      ) : (
        formatPhone(conversation.phone)
      ),
  },
  {
    id: "last",
    header: "Último mensaje",
    cell: ({ lastMessage }) => (
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground max-w-md truncate">{messageText(lastMessage)}</span>
        <MessageStatus message={lastMessage} />
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
  const { conversations: result, handoffs } = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Conversaciones"
        description="Los mensajes de WhatsApp con los pacientes."
      />
      {handoffs.ok && <OpenHandoffList handoffs={handoffs.handoffs} />}
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
  // A search's answer is one page, counted against everything it matched.
  const searchPager = search.found
    ? { page: 1, pageCount: 1, total: search.found.total, onPageChange: () => {} }
    : undefined;
  const more =
    search.found && search.found.total > search.found.conversations.length
      ? "Se muestran las conversaciones más recientes. Escribí más para acotar la búsqueda."
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
        pager={search.searching ? searchPager : pager}
        noRecords={!search.searching && listed.total === 0}
        empty={
          search.refused ? (
            <ErrorAlert message={searchRefusalMessages[search.refused]} />
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
