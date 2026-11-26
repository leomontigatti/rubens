import { CalendarXIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { rangeEntryLabel } from "#/lib/time-ranges.ts";
import { getClosures } from "#/server/closures.functions.ts";
import type { Closure } from "#/organization/closures.ts";

import { refusalMessages } from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/")({
  head: () => ({ meta: [{ title: "Cierres · underthing" }] }),
  loader: () => getClosures(),
  component: ClosureList,
});

function ClosureList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cierres"
        description="Los días en que no se atiende: un feriado o un día sin atención."
        actions={
          <CreateButton can={result.canEdit} link={<Link to="/cierres/nuevo" />}>
            Nuevo cierre
          </CreateButton>
        }
      />
      <ClosureTable closures={result.closures} canEdit={result.canEdit} />
    </div>
  );
}

/** A closure in the list, with when it closes, and whether the viewer may open its page. */
type ListedClosure = Closure & { when: string; canOpen: boolean };

const columns: DataTableColumn<ListedClosure>[] = [
  {
    id: "when",
    header: "Cuándo",
    cell: (closure) => (
      <RowName
        name={closure.when}
        transitionId={closure.id}
        link={
          closure.canOpen
            ? { to: "/cierres/$closureId", params: { closureId: closure.id } }
            : undefined
        }
      />
    ),
  },
];

function ClosureTable({ closures, canEdit }: { closures: Closure[]; canEdit: boolean }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: closures.map((closure) => ({
      ...closure,
      when: rangeEntryLabel(closure.entry),
      canOpen: canEdit,
    })),
    columns,
    getRowId: (closure) => closure.id,
    searchText: (closure) => closure.when,
  });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar cierre",
        placeholder: "Buscar por fecha",
      }}
      noRecords={closures.length === 0}
      empty={
        closures.length === 0 ? (
          <EmptyState
            icon={CalendarXIcon}
            title="Sin cierres"
            description={`Todavía no hay cierres.${canEdit ? " Empezá creando el primero." : ""}`}
          >
            {canEdit && (
              <CreateButton link={<Link to="/cierres/nuevo" />}>Nuevo cierre</CreateButton>
            )}
          </EmptyState>
        ) : (
          <NoMatches icon={CalendarXIcon} />
        )
      }
    />
  );
}
