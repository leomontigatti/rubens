import { UserCogIcon } from "lucide-react";
import { ActiveBadge } from "#/components/admin-form.tsx";
import { Link, createFileRoute } from "@tanstack/react-router";

import { CreateButton } from "#/components/form-page.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { rolesLabel } from "#/lib/staff.ts";
import { getStaff } from "#/server/staff.functions.ts";
import type { StaffMember } from "#/organization/staff.ts";

import { RefusalAlert } from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/")({
  head: () => ({ meta: [{ title: "Personal · underthing" }] }),
  loader: () => getStaff(),
  component: Staff,
});

function Staff() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Personal"
        description="Las personas de la organización, con sus roles y su acceso."
        actions={
          <CreateButton can link={<Link to="/personal/nueva" />}>
            Nueva persona
          </CreateButton>
        }
      />
      <StaffTable staff={result.staff} />
    </div>
  );
}

const columns: DataTableColumn<StaffMember>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (member) => (
      <RowName
        name={member.name}
        link={{ to: "/personal/$memberId", params: { memberId: member.memberId } }}
        status={<ActiveBadge active={member.active} ending="o" />}
      />
    ),
  },
  { id: "email", header: "Correo", cell: (member) => member.email },
  { id: "roles", header: "Roles", cell: (member) => rolesLabel(member.roles) },
];

function StaffTable(props: { staff: StaffMember[] }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: props.staff,
    columns,
    getRowId: (member) => member.memberId,
    searchText: (member) => `${member.name} ${member.email}`,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar persona",
        placeholder: "Buscar por nombre o correo",
      }}
      empty={<NoMatches icon={UserCogIcon} />}
    />
  );
}
