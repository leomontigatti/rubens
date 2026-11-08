import { ShieldIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { showsAllPick, statusFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { insurerKindLabels } from "#/lib/coverages.ts";
import { getInsurers } from "#/server/insurers.functions.ts";
import type { Insurer } from "#/organization/insurers.ts";

import { refusalMessages } from "#/routes/_app/obras-sociales/-insurer-form.tsx";

export const Route = createFileRoute("/_app/obras-sociales/")({
  head: () => ({ meta: [{ title: "Obras sociales y prepagas · underthing" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getInsurers({ data: deps }),
  component: Insurers,
});

function Insurers() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Obras sociales y prepagas"
        description="Las coberturas que se pueden cargar en cada paciente."
        actions={
          <CreateButton can={isAdmin} link={<Link to="/obras-sociales/nueva" />}>
            Nueva obra social o prepaga
          </CreateButton>
        }
      />
      <InsurerTable
        insurers={result.insurers}
        onlyInactive={result.onlyInactive}
        isAdmin={isAdmin}
      />
    </div>
  );
}

/** An insurer in the list, and whether the viewer may open its page. */
type ListedInsurer = Insurer & { canOpen: boolean };

const columns: DataTableColumn<ListedInsurer>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (insurer) =>
      insurer.canOpen ? (
        <RowLink to="/obras-sociales/$insurerId" params={{ insurerId: insurer.id }}>
          {insurer.name}
        </RowLink>
      ) : (
        insurer.name
      ),
  },
  { id: "kind", header: "Tipo", cell: (insurer) => insurerKindLabels[insurer.kind] },
  {
    id: "status",
    header: "Estado",
    cell: (insurer) => !insurer.active && <Badge variant="secondary">Inactiva</Badge>,
  },
];

function InsurerTable(props: { insurers: Insurer[]; onlyInactive: boolean; isAdmin: boolean }) {
  const { insurers, onlyInactive, isAdmin } = props;
  const { inactivas } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: insurers.map((insurer) => ({ ...insurer, canOpen: isAdmin })),
    columns,
    getRowId: (insurer) => insurer.id,
    searchText: (insurer) => insurer.name,
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
        label: "Buscar obra social o prepaga",
        placeholder: "Buscar por nombre",
      }}
      filters={{
        groups: [statusFilter(inactivas, { active: "Activas", all: "Todas" })],
        onPick: (_id, value) => changeStatus(value),
        onRemove: () => changeStatus(null),
      }}
      noRecords={insurers.length === 0}
      empty={
        insurers.length === 0 ? (
          <NoInsurers onlyInactive={onlyInactive} isAdmin={isAdmin} />
        ) : (
          <NoMatches icon={ShieldIcon} />
        )
      }
    />
  );
}

/** The insurer list with no records, or none active; only an admin creates one. */
function NoInsurers(props: { onlyInactive: boolean; isAdmin: boolean }) {
  const { onlyInactive, isAdmin } = props;
  return (
    <EmptyState
      icon={ShieldIcon}
      title={
        onlyInactive ? "Sin obras sociales ni prepagas activas" : "Sin obras sociales ni prepagas"
      }
      description={
        onlyInactive
          ? `No hay obras sociales ni prepagas activas. ${isAdmin ? "Empezá creando una, o mirá" : "Mirá"} las inactivas.`
          : `Todavía no hay obras sociales ni prepagas.${isAdmin ? " Empezá creando la primera." : ""}`
      }
    >
      {isAdmin && (
        <CreateButton link={<Link to="/obras-sociales/nueva" />}>
          Nueva obra social o prepaga
        </CreateButton>
      )}
      {onlyInactive && (
        <EmptyStateLink
          variant={isAdmin ? "outline" : "default"}
          link={<Link to="/obras-sociales" search={{ inactivas: true }} />}
        >
          Ver inactivas
        </EmptyStateLink>
      )}
    </EmptyState>
  );
}
