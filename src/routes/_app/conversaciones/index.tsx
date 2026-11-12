import { ArrowRightLeftIcon, MessagesSquareIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useServerDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import type { FilterGroup } from "#/components/filter-groups.ts";
import { PageHeader } from "#/components/page-header.tsx";
import { useDebounced } from "#/components/use-debounced.ts";
import { formatPhone } from "#/lib/phones.ts";
import { conversationPageSize } from "#/lib/whatsapp-messages.ts";
import { findConversations, getConversations } from "#/server/inbox.functions.ts";
import type { ConversationSummary } from "#/organization/inbox.ts";

import { messageText, messageTime, registeredName } from "#/routes/_app/conversaciones/-labels.ts";
import { HandoffSummary } from "#/routes/_app/conversaciones/-handoffs.tsx";
import { MessageStatus, refusalMessages } from "#/routes/_app/conversaciones/-messages.tsx";

// The inbox (ui: "Conversaciones"): the WhatsApp conversations the member
// reads, those with an open handoff first, then latest first, a page at a
// time; the `Derivación` filter narrows it to the open handoffs. Which ones,
// and which messages' words, the object decides by role
// (docs/domain/assistant.md § Inbox).

export const Route = createFileRoute("/_app/conversaciones/")({
  head: () => ({ meta: [{ title: "Conversaciones · underthing" }] }),
  // The search text stays out of the address: a URL ends up in proxy logs and
  // the browser's history, and patient data must not.
  validateSearch: z.object({
    pagina: z.number().int().positive().optional().catch(undefined),
    derivacion: z.literal("abierta").optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    page: search.pagina,
    withHandoff: search.derivacion === "abierta",
  }),
  loader: async ({ deps }) => ({ conversations: await getConversations({ data: deps }) }),
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
    id: "handoff",
    header: "Derivación",
    cell: ({ handoffs }) => <HandoffSummary handoffs={handoffs} />,
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

/** The `Derivación` filter: the conversations with an open handoff, or all of them. */
function handoffFilter(withHandoff: boolean): FilterGroup {
  return {
    id: "derivacion",
    label: "Derivación",
    icon: ArrowRightLeftIcon,
    value: withHandoff ? "abierta" : null,
    options: [{ value: "abierta", label: "Con derivación abierta" }],
  };
}

/**
 * The conversations matching what is typed, asked for once typing pauses;
 * only the answer to the text in the box is shown.
 */
function useConversationSearch(typed: string, withHandoff: boolean) {
  const { viewer } = Route.useRouteContext();
  const asked = useDebounced(typed.trim(), searchDelay);
  const answer = useQuery({
    queryKey: ["conversation-search", viewer.organizationId, viewer.userId, asked, withHandoff],
    queryFn: () => findConversations({ data: { query: asked, withHandoff } }),
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
  const { conversations: result } = Route.useLoaderData();

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
  const { derivacion } = Route.useSearch();
  const withHandoff = derivacion === "abierta";
  const [query, setQuery] = useState("");
  const search = useConversationSearch(query, withHandoff);
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
        filters={{
          groups: [handoffFilter(withHandoff)],
          // A new filter starts the list over, on its first page.
          onPick: () => void navigate({ search: { derivacion: "abierta" } }),
          onRemove: () => void navigate({ search: {} }),
        }}
        pager={search.searching ? searchPager : pager}
        noRecords={!search.searching && !withHandoff && listed.total === 0}
        empty={<NoConversations search={search} withHandoff={withHandoff} />}
      />
      {more && <p className="text-muted-foreground text-sm">{more}</p>}
    </div>
  );
}

/** What the list shows with no rows: the search's refusal or no match, then why the list is empty. */
function NoConversations(props: {
  search: ReturnType<typeof useConversationSearch>;
  withHandoff: boolean;
}) {
  const { search } = props;
  if (search.refused) {
    return <ErrorAlert message={searchRefusalMessages[search.refused]} />;
  }
  if (search.searching) {
    return search.found && <NoMatches icon={MessagesSquareIcon} />;
  }
  return props.withHandoff ? (
    <EmptyState
      icon={ArrowRightLeftIcon}
      title="Sin derivaciones abiertas"
      description="Ninguna conversación espera la respuesta de una persona."
    />
  ) : (
    <EmptyState
      icon={MessagesSquareIcon}
      title="Sin conversaciones"
      description="Todavía no hay conversaciones de WhatsApp."
    />
  );
}
