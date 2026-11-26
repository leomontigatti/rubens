import { BuildingIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { getOffices } from "#/server/offices.functions.ts";
import type { Office } from "#/organization/offices.ts";

import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/")({
  head: () => ({ meta: [{ title: "Sedes · underthing" }] }),
  loader: () => getOffices({ data: { includeInactive: false } }),
  component: Offices,
});

function Offices() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sedes"
        description="Los lugares de atención, cada uno con sus consultorios."
      />
      <OfficeTable offices={result.offices} />
    </div>
  );
}

const columns: DataTableColumn<Office>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (office) => (
      <RowName
        name={office.name}
        link={{ to: "/sedes/$officeId", params: { officeId: office.id } }}
        transitionId={office.id}
      />
    ),
  },
  { id: "address", header: "Domicilio", cell: (office) => office.address },
];

function OfficeTable(props: { offices: Office[] }) {
  const { offices } = props;
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: offices,
    columns,
    getRowId: (office) => office.id,
    searchText: (office) => `${office.name} ${office.address}`,
  });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar sede",
        placeholder: "Buscar por nombre o domicilio",
      }}
      noRecords={offices.length === 0}
      empty={<NoMatches icon={BuildingIcon} />}
    />
  );
}
