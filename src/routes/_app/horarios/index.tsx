import { createFileRoute } from "@tanstack/react-router";

import { DataTable, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { NoPractitioners } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { getSchedulePractitioners } from "#/server/schedules.functions.ts";

import { RefusalAlert } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/")({
  head: () => ({ meta: [{ title: "Horarios · Rubens" }] }),
  loader: () => getSchedulePractitioners(),
  component: SchedulePractitioners,
});

function SchedulePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Horarios" />
      {result.practitioners.length === 0 ? (
        <NoPractitioners />
      ) : (
        <Practitioners practitioners={result.practitioners} />
      )}
    </div>
  );
}

interface Practitioner {
  id: string;
  displayName: string;
}

const columns: DataTableColumn<Practitioner>[] = [
  {
    id: "name",
    header: "Profesional",
    cell: (practitioner) => (
      <RowLink to="/horarios/$practitionerId" params={{ practitionerId: practitioner.id }}>
        {practitioner.displayName}
      </RowLink>
    ),
  },
];

function Practitioners(props: { practitioners: Practitioner[] }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: props.practitioners,
    columns,
    getRowId: (practitioner) => practitioner.id,
    searchText: (practitioner) => practitioner.displayName,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar profesional",
        placeholder: "Buscar por nombre",
      }}
    />
  );
}
