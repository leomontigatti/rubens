import { BuildingIcon } from "lucide-react";
import { ArchivedBadge } from "#/components/admin-form.tsx";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { includesArchivedPick, archivedFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { getOffices } from "#/server/offices.functions.ts";
import type { Office } from "#/organization/offices.ts";

import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/")({
  head: () => ({ meta: [{ title: "Sedes · underthing" }] }),
  validateSearch: z.object({ archivadas: z.boolean().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ includeInactive: search.archivadas ?? false }),
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
      <PageHeader
        title="Sedes"
        description="Los lugares de atención, cada uno con sus consultorios."
        actions={
          <CreateButton can={isAdmin} link={<Link to="/sedes/nueva" />}>
            Nueva sede
          </CreateButton>
        }
      />
      <OfficeTable offices={result.offices} onlyInactive={result.onlyInactive} isAdmin={isAdmin} />
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
        status={<ArchivedBadge active={office.active} ending="a" />}
      />
    ),
  },
  { id: "address", header: "Domicilio", cell: (office) => office.address },
];

function OfficeTable(props: { offices: Office[]; onlyInactive: boolean; isAdmin: boolean }) {
  const { offices, onlyInactive, isAdmin } = props;
  const { archivadas } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: offices,
    columns,
    getRowId: (office) => office.id,
    searchText: (office) => `${office.name} ${office.address}`,
  });
  const changeStatus = (value: string | null) =>
    void navigate({ search: { archivadas: includesArchivedPick(value) } });

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
      filters={{
        groups: [archivedFilter(archivadas, { group: "Archivadas", included: "Incluidas" })],
        onPick: (_id, value) => changeStatus(value),
        onRemove: () => changeStatus(null),
      }}
      noRecords={offices.length === 0}
      empty={
        offices.length === 0 ? (
          <NoOffices onlyInactive={onlyInactive} isAdmin={isAdmin} />
        ) : (
          <NoMatches icon={BuildingIcon} />
        )
      }
    />
  );
}

/** The office list with no records, or none active; only an admin creates one. */
function NoOffices(props: { onlyInactive: boolean; isAdmin: boolean }) {
  const { onlyInactive, isAdmin } = props;
  return (
    <EmptyState
      icon={BuildingIcon}
      title={onlyInactive ? "Sin sedes activas" : "Sin sedes"}
      description={
        onlyInactive
          ? `No hay sedes activas. ${isAdmin ? "Empezá creando una, o mirá" : "Mirá"} las archivadas.`
          : `Todavía no hay sedes.${isAdmin ? " Empezá creando la primera." : ""}`
      }
    >
      {isAdmin && <CreateButton link={<Link to="/sedes/nueva" />}>Nueva sede</CreateButton>}
      {onlyInactive && (
        <EmptyStateLink
          variant={isAdmin ? "outline" : "default"}
          link={<Link to="/sedes" search={{ archivadas: true }} />}
        >
          Ver archivadas
        </EmptyStateLink>
      )}
    </EmptyState>
  );
}
