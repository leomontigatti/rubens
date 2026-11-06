import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ActiveToggle, ErrorAlert } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { showsAllPick, statusFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { capacityLabel } from "#/lib/offices.ts";
import {
  changeOfficeActive,
  getOfficeUpcomingCount,
  getOfficeWithRooms,
} from "#/server/offices.functions.ts";
import type { Office, Room } from "#/organization/offices.ts";

import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId")({
  validateSearch: z.object({ inactivos: z.boolean().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivos ?? false }),
  loader: ({ params, deps }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, ...deps } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.ok ? `${loaderData.office.name} · Rubens` : "Sede · Rubens" }],
  }),
  component: OfficeRooms,
});

function OfficeRooms() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { officeId } = Route.useParams();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <OfficeHeading office={result.office} isAdmin={isAdmin} />
      <h2 className="text-lg font-semibold">Consultorios</h2>
      <CreateButton
        can={isAdmin && result.office.active}
        link={<Link to="/sedes/$officeId/consultorios/nuevo" params={{ officeId }} />}
      >
        Nuevo consultorio
      </CreateButton>
      <RoomTable rooms={result.rooms} isAdmin={isAdmin} canAdd={isAdmin && result.office.active} />
    </div>
  );
}

function OfficeHeading({ office, isAdmin }: { office: Office; isAdmin: boolean }) {
  const toggle = useAction();

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        back={{ to: "/sedes", label: "Sedes" }}
        title={office.name}
        status={!office.active && <Badge variant="secondary">Inactiva</Badge>}
        description={
          <p className="text-muted-foreground text-sm">
            {office.address} · {office.timeZone}
          </p>
        }
        actions={
          isAdmin && (
            <>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/sedes/$officeId/editar" params={{ officeId: office.id }} />}
              >
                Editar
              </Button>
              <ActiveToggle
                key={office.id}
                active={office.active}
                pending={toggle.pending}
                onChange={(active) =>
                  void toggle.run(() => changeOfficeActive({ data: { id: office.id, active } }))
                }
                deactivation={{
                  question: `¿Desactivar ${office.name}?`,
                  countUpcoming: () => getOfficeUpcomingCount({ data: { id: office.id } }),
                }}
              />
            </>
          )
        }
      />
      <ErrorAlert message={toggle.error} />
    </div>
  );
}

/** A room in the list, and whether the viewer may open its page. */
type ListedRoom = Room & { canOpen: boolean };

const columns: DataTableColumn<ListedRoom>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (room) =>
      room.canOpen ? (
        <RowLink
          to="/sedes/$officeId/consultorios/$roomId"
          params={{ officeId: room.officeId, roomId: room.id }}
        >
          {room.name}
        </RowLink>
      ) : (
        room.name
      ),
  },
  { id: "capacity", header: "Capacidad", cell: (room) => capacityLabel(room.capacity) },
  {
    id: "status",
    header: "Estado",
    cell: (room) => !room.active && <Badge variant="secondary">Inactivo</Badge>,
  },
];

function RoomTable(props: { rooms: Room[]; isAdmin: boolean; canAdd: boolean }) {
  const { rooms, isAdmin } = props;
  const { inactivos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: rooms.map((room) => ({ ...room, canOpen: isAdmin })),
    columns,
    getRowId: (room) => room.id,
    searchText: (room) => room.name,
  });
  const changeStatus = (value: string | null) =>
    void navigate({ search: { inactivos: showsAllPick(value) } });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar consultorio",
        placeholder: "Buscar por nombre",
      }}
      filters={{
        groups: [statusFilter(inactivos, { active: "Activos", all: "Todos" })],
        onPick: (_id, value) => changeStatus(value),
        onRemove: () => changeStatus(null),
      }}
      empty={
        rooms.length === 0 ? (
          <EmptyState
            icon={BuildingIcon}
            title="No hay consultorios para mostrar"
            description={`Agregá uno con Nuevo consultorio${inactivos ? "" : ", o mirá los inactivos"}.`}
            canAct={props.canAdd}
          />
        ) : (
          <NoMatches icon={BuildingIcon} />
        )
      }
    />
  );
}
