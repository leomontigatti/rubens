import { createFileRoute } from "@tanstack/react-router";

import { DataTable, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { NoPractitioners } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { getMedicalServicePractitioners } from "#/server/medical-services.functions.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/")({
  head: () => ({ meta: [{ title: "Prestaciones · Rubens" }] }),
  loader: () => getMedicalServicePractitioners(),
  component: MedicalServicePractitioners,
});

function MedicalServicePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Prestaciones" />
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
      <RowLink to="/prestaciones/$practitionerId" params={{ practitionerId: practitioner.id }}>
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
