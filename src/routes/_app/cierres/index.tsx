import { CalendarXIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { rangeEntryLabel } from "#/lib/time-ranges.ts";
import { getClosures } from "#/server/closures.functions.ts";
import type { Closure } from "#/organization/closures.ts";

import { closurePlace, refusalMessages } from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/")({
  head: () => ({ meta: [{ title: "Cierres · Rubens" }] }),
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
        description="Los días en que una sede, o todas, no atiende: un feriado o un día sin atención."
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

/** A closure in the list, with what it closes, and whether the viewer may open its page. */
type ListedClosure = Closure & { place: string; canOpen: boolean };

const columns: DataTableColumn<ListedClosure>[] = [
  {
    id: "place",
    header: "Sede",
    cell: (closure) =>
      closure.canOpen ? (
        <RowLink to="/cierres/$closureId" params={{ closureId: closure.id }}>
          {closure.place}
        </RowLink>
      ) : (
        closure.place
      ),
  },
  { id: "when", header: "Cuándo", cell: (closure) => rangeEntryLabel(closure.entry) },
];

function ClosureTable({ closures, canEdit }: { closures: Closure[]; canEdit: boolean }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: closures.map((closure) => ({
      ...closure,
      place: closurePlace(closure),
      canOpen: canEdit,
    })),
    columns,
    getRowId: (closure) => closure.id,
    searchText: (closure) => closure.place,
  });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar cierre",
        placeholder: "Buscar por sede",
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
