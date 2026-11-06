import { TreePalmIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
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
      <PageHeader title="Licencias" />
      <CreateButton can={canCreate} link={<Link to="/licencias/nueva" />}>
        Nueva licencia
      </CreateButton>
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

function TimeOffTable({ timeOff, canCreate }: { timeOff: TimeOff[]; canCreate: boolean }) {
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
      empty={
        timeOff.length === 0 ? (
          <EmptyState
            icon={TreePalmIcon}
            title="Todavía no hay licencias"
            description="Agregá la primera con Nueva licencia."
            canAct={canCreate}
          />
        ) : (
          <NoMatches icon={TreePalmIcon} />
        )
      }
    />
  );
}
