import { DoorOpenIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import * as z from "zod";

import { ActionsMenu, ArchivedBadge } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { archivedFilter, includesArchivedPick } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { getOfficeWithRooms } from "#/server/offices.functions.ts";
import type { Office, Room } from "#/organization/offices.ts";

import { useRoomDialog } from "#/routes/_app/consultorios/-room-form.tsx";
import { RefusedPage } from "#/routes/_app/consultorios/-shared.tsx";

// The organization's rooms are the page, and its one office is the line under
// the title, edited from `Acciones` (LEO-6's prototype pass, variant C).

export const Route = createFileRoute("/_app/consultorios/")({
  validateSearch: z.object({
    archivados: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ includeInactive: search.archivados ?? false }),
  loader: ({ deps }) => getOfficeWithRooms({ data: deps }),
  head: () => ({ meta: [{ title: "Consultorios · underthing" }] }),
  component: Rooms,
});

function Rooms() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusedPage title="Consultorios" reason={result.reason} />;
  }
  if (!viewer.roles.includes("admin")) {
    return (
      <div className="flex flex-col gap-6">
        <RoomsHeader office={result.office} />
        <RoomTable rooms={result.rooms} onlyInactive={result.onlyInactive} />
      </div>
    );
  }
  return (
    <EditRooms office={result.office} rooms={result.rooms} onlyInactive={result.onlyInactive} />
  );
}

/** An admin's page: the office's data from `Acciones`, and each room in a dialog over the list. */
function EditRooms(props: { office: Office; rooms: Room[]; onlyInactive: boolean }) {
  const roomDialog = useRoomDialog(props.office.id, props.rooms);
  return (
    <div className="flex flex-col gap-6">
      <RoomsHeader
        office={props.office}
        actions={
          <>
            <ActionsMenu disabled={false}>
              <DropdownMenuItem render={<Link to="/consultorios/sede" />}>
                Datos de la sede
              </DropdownMenuItem>
            </ActionsMenu>
            <CreateButton onClick={roomDialog.create}>Nuevo consultorio</CreateButton>
          </>
        }
      />
      <RoomTable
        rooms={props.rooms}
        onlyInactive={props.onlyInactive}
        onOpen={roomDialog.edit}
        onCreate={roomDialog.create}
      />
      {roomDialog.dialog}
    </div>
  );
}

/** The page's title, with the office's name and address under it. */
function RoomsHeader(props: { office: Office; actions?: ReactNode }) {
  return (
    <PageHeader
      title="Consultorios"
      description={`${props.office.name}, ${props.office.address}.`}
      actions={props.actions}
    />
  );
}

/** A room in the list, and how it opens for whoever may edit it. */
type ListedRoom = Room & { open?: () => void };

const columns: DataTableColumn<ListedRoom>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (room) => (
      <RowName
        name={room.name}
        onOpen={room.open}
        status={<ArchivedBadge active={room.active} ending="o" />}
      />
    ),
  },
];

/**
 * The rooms: for an admin, a name opens the room's dialog (`onOpen`), and
 * `onCreate` a new one's.
 */
function RoomTable(props: {
  rooms: Room[];
  onlyInactive: boolean;
  onOpen?: (room: Room) => void;
  onCreate?: () => void;
}) {
  const { rooms, onOpen } = props;
  const { archivados } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: rooms.map((room) => ({ ...room, open: onOpen && (() => onOpen(room)) })),
    columns,
    getRowId: (room) => room.id,
    searchText: (room) => room.name,
  });
  const changeStatus = (value: string | null) =>
    void navigate({ search: (prev) => ({ ...prev, archivados: includesArchivedPick(value) }) });

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
        groups: [archivedFilter(archivados, { group: "Archivados", included: "Incluidos" })],
        onPick: (_id, value) => changeStatus(value),
        onRemove: () => changeStatus(null),
      }}
      noRecords={rooms.length === 0}
      empty={
        rooms.length === 0 ? (
          <NoRooms onlyInactive={props.onlyInactive} onCreate={props.onCreate} />
        ) : (
          <NoMatches icon={DoorOpenIcon} />
        )
      }
    />
  );
}

/** The room list with no records, or none active. */
function NoRooms(props: { onlyInactive: boolean; onCreate?: () => void }) {
  const canAdd = Boolean(props.onCreate);
  return (
    <EmptyState
      icon={DoorOpenIcon}
      title={props.onlyInactive ? "Sin consultorios activos" : "Sin consultorios"}
      description={
        props.onlyInactive
          ? `No hay consultorios activos. ${canAdd ? "Empezá creando uno, o mirá" : "Mirá"} los archivados.`
          : `Todavía no hay consultorios.${canAdd ? " Empezá creando el primero." : ""}`
      }
    >
      {props.onCreate && <CreateButton onClick={props.onCreate}>Nuevo consultorio</CreateButton>}
      {props.onlyInactive && (
        <EmptyStateLink
          variant={canAdd ? "outline" : "default"}
          link={<Link to="/consultorios" search={{ archivados: true }} />}
        >
          Ver archivados
        </EmptyStateLink>
      )}
    </EmptyState>
  );
}
