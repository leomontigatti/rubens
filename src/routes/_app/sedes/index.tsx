import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { showsAllPick, statusFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { getOffices } from "#/server/offices.functions.ts";
import type { Office } from "#/organization/offices.ts";

import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/")({
  head: () => ({ meta: [{ title: "Sedes · Rubens" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getOffices({ data: deps }),
  component: Offices,
});

function Offices() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sedes" />
      <CreateButton can={isAdmin} link={<Link to="/sedes/nueva" />}>
        Nueva sede
      </CreateButton>
      <OfficeTable offices={result.offices} isAdmin={isAdmin} />
    </div>
  );
}

const columns: DataTableColumn<Office>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (office) => (
      <RowLink to="/sedes/$officeId" params={{ officeId: office.id }}>
        {office.name}
      </RowLink>
    ),
  },
  { id: "address", header: "Dirección", cell: (office) => office.address },
  { id: "timeZone", header: "Zona horaria", cell: (office) => office.timeZone },
  {
    id: "status",
    header: "Estado",
    cell: (office) => !office.active && <Badge variant="secondary">Inactiva</Badge>,
  },
];

function OfficeTable({ offices, isAdmin }: { offices: Office[]; isAdmin: boolean }) {
  const { inactivas } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: offices,
    columns,
    getRowId: (office) => office.id,
    searchText: (office) => `${office.name} ${office.address}`,
  });
  const changeStatus = (value: string | null) =>
    void navigate({ search: { inactivas: showsAllPick(value) } });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar sede",
        placeholder: "Buscar por nombre o dirección",
      }}
      filters={{
        groups: [statusFilter(inactivas, { active: "Activas", all: "Todas" })],
        onPick: (_id, value) => changeStatus(value),
        onRemove: () => changeStatus(null),
      }}
      empty={
        offices.length === 0 ? (
          <EmptyState
            icon={BuildingIcon}
            title="No hay sedes para mostrar"
            description={`Agregá una con Nueva sede${inactivas ? "" : ", o mirá las inactivas"}.`}
            canAct={isAdmin}
          />
        ) : (
          <NoMatches icon={BuildingIcon} />
        )
      }
    />
  );
}
