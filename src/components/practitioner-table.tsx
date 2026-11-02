import type { LucideIcon } from "lucide-react";

import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";

// The practitioners a screen picks from, on the way to one practitioner's page.

interface Practitioner {
  id: string;
  displayName: string;
}

export function practitionerColumns(
  to: "/horarios/$practitionerId" | "/prestaciones/$practitionerId",
): DataTableColumn<Practitioner>[] {
  return [
    {
      id: "name",
      header: "Profesional",
      cell: (practitioner) => (
        <RowLink to={to} params={{ practitionerId: practitioner.id }}>
          {practitioner.displayName}
        </RowLink>
      ),
    },
  ];
}

export function PractitionerTable(props: {
  practitioners: Practitioner[];
  columns: DataTableColumn<Practitioner>[];
  icon: LucideIcon;
}) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: props.practitioners,
    columns: props.columns,
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
      empty={<NoMatches icon={props.icon} />}
    />
  );
}
