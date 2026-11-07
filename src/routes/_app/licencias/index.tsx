import { TreePalmIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { rangeEntryLabel } from "#/lib/time-ranges.ts";
import { getTimeOff } from "#/server/time-off.functions.ts";
import type { TimeOff } from "#/organization/time-off.ts";

import { refusalMessages } from "#/routes/_app/licencias/-shared.ts";

export const Route = createFileRoute("/_app/licencias/")({
  head: () => ({ meta: [{ title: "Licencias · Rubens" }] }),
  loader: () => getTimeOff(),
  component: TimeOffList,
});

function TimeOffList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const canCreate = result.practitioners.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Licencias"
        description="Los días en que un profesional no atiende, por vacaciones o por enfermedad."
        actions={
          <CreateButton can={canCreate} link={<Link to="/licencias/nueva" />}>
            Nueva licencia
          </CreateButton>
        }
      />
      <TimeOffTable timeOff={result.timeOff} canCreate={canCreate} />
    </div>
  );
}

const columns: DataTableColumn<TimeOff>[] = [
  {
    id: "practitioner",
    header: "Profesional",
    cell: (item) =>
      item.canEdit ? (
        <RowLink to="/licencias/$timeOffId" params={{ timeOffId: item.id }}>
          {item.practitionerName}
        </RowLink>
      ) : (
        item.practitionerName
      ),
  },
  { id: "when", header: "Cuándo", cell: (item) => rangeEntryLabel(item.entry) },
];

/**
 * An admin may record time off for every practitioner, so with none to pick
 * there is no practitioner yet.
 */
function noLicensesYet(canCreate: boolean, isAdmin: boolean) {
  if (canCreate) {
    return "Todavía no hay licencias. Empezá creando la primera.";
  }
  return isAdmin
    ? "Todavía no hay licencias. Empezá agregando un profesional en Personal."
    : "Todavía no hay licencias.";
}

function TimeOffTable({ timeOff, canCreate }: { timeOff: TimeOff[]; canCreate: boolean }) {
  const isAdmin = Route.useRouteContext().viewer.roles.includes("admin");
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: timeOff,
    columns,
    getRowId: (item) => item.id,
    searchText: (item) => item.practitionerName,
  });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar licencia",
        placeholder: "Buscar por profesional",
      }}
      noRecords={timeOff.length === 0}
      empty={
        timeOff.length === 0 ? (
          <EmptyState
            icon={TreePalmIcon}
            title="Sin licencias"
            description={noLicensesYet(canCreate, isAdmin)}
          >
            {canCreate && (
              <CreateButton link={<Link to="/licencias/nueva" />}>Nueva licencia</CreateButton>
            )}
            {!canCreate && isAdmin && (
              <EmptyStateLink link={<Link to="/personal" />}>Ir a Personal</EmptyStateLink>
            )}
          </EmptyState>
        ) : (
          <NoMatches icon={TreePalmIcon} />
        )
      }
    />
  );
}
