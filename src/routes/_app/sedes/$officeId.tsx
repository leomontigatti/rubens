import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { ActionsMenu, ArchivedBadge } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { includesArchivedPick, archivedFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RecordName } from "#/components/record-transition.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { editOffice, getOfficeWithRooms } from "#/server/offices.functions.ts";
import type { Office, Room } from "#/organization/offices.ts";

import { OfficeForm } from "#/routes/_app/sedes/-office-form.tsx";
import { useRoomDialog } from "#/routes/_app/sedes/-room-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

/** The page's subtitle, the same for every office and every role. */
const officeDescription = "Los datos de la sede y los consultorios donde se atiende.";

/** The page's tabs: the office's own data, and its rooms. */
const sections = ["datos", "consultorios"] as const;
type Section = (typeof sections)[number];

export const Route = createFileRoute("/_app/sedes/$officeId")({
  validateSearch: z.object({
    archivados: z.boolean().optional().catch(undefined),
    seccion: z.enum(sections).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ includeInactive: search.archivados ?? false }),
  loader: ({ params, deps }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, ...deps } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.ok ? `${loaderData.office.name} · underthing` : "Sede · underthing" },
    ],
  }),
  staticData: { crumbs: Crumbs },
  component: OfficePage,
});

function OfficePage() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <OfficeHeading office={result.office} />
        <RoomTable
          officeId={result.office.id}
          rooms={result.rooms}
          onlyInactive={result.onlyInactive}
        />
      </div>
    );
  }
  return (
    <EditOffice office={result.office} rooms={result.rooms} onlyInactive={result.onlyInactive} />
  );
}

/**
 * An admin's office page: titled by the office, with a new room in its
 * `Acciones`, and two tabs, the office's form and its rooms, which open in a
 * dialog over it.
 */
function EditOffice(props: { office: Office; rooms: Room[]; onlyInactive: boolean }) {
  const { office, rooms } = props;
  const roomDialog = useRoomDialog(office.id, rooms);
  const activeRooms = rooms.filter((room) => room.active).length;
  // The URL picks the tab a page opens on (a room's pages come back to
  // `Consultorios`); a click switches it here, since a navigation would ask
  // before discarding an unsaved edit.
  const { seccion = "datos" } = Route.useSearch();
  const [section, setSection] = useState<Section>(seccion);
  const record = {
    transitionId: office.id,
    error: null,
    actions: (busy: boolean) => (
      <ActionsMenu disabled={busy}>
        <DropdownMenuItem onClick={roomDialog.create}>Nuevo consultorio</DropdownMenuItem>
      </ActionsMenu>
    ),
  };
  return (
    <OfficeForm
      key={office.id}
      title={office.name}
      description={officeDescription}
      initial={office}
      submitLabel="Guardar"
      record={record}
      frame={(form) => (
        <>
          <Tabs value={section} onValueChange={(value: Section) => setSection(value)}>
            <TabsList className="w-full">
              <TabsTrigger value="datos">Datos generales</TabsTrigger>
              <TabsTrigger value="consultorios">
                Consultorios
                <Badge variant="outline">{activeRooms}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="datos" keepMounted>
              {form}
            </TabsContent>
            <TabsContent value="consultorios">
              <RoomTable
                officeId={office.id}
                rooms={rooms}
                onlyInactive={props.onlyInactive}
                onOpen={roomDialog.edit}
                onCreate={roomDialog.create}
              />
            </TabsContent>
          </Tabs>
          {/* Outside the tabs: `Acciones` opens it from either. */}
          {roomDialog.dialog}
        </>
      )}
      onSubmit={(input) => editOffice({ data: { ...input, officeId: office.id } })}
    />
  );
}

/** The office's name and address, for those who can't change it. */
function OfficeHeading({ office }: { office: Office }) {
  return (
    <PageHeader
      title={<RecordName id={office.id}>{office.name}</RecordName>}
      description={officeDescription}
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
 * The office's rooms: for an admin, a name opens the room's dialog
 * (`onOpen`), and `onCreate` a new one's.
 */
function RoomTable(props: {
  officeId: string;
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
          <NoRooms
            officeId={props.officeId}
            onlyInactive={props.onlyInactive}
            onCreate={props.onCreate}
          />
        ) : (
          <NoMatches icon={BuildingIcon} />
        )
      }
    />
  );
}

/** The office's room list with no records, or none active. */
function NoRooms(props: { officeId: string; onlyInactive: boolean; onCreate?: () => void }) {
  const canAdd = Boolean(props.onCreate);
  return (
    <EmptyState
      icon={BuildingIcon}
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
          link={
            <Link
              to="/sedes/$officeId"
              params={{ officeId: props.officeId }}
              search={{ archivados: true, seccion: "consultorios" }}
            />
          }
        >
          Ver archivados
        </EmptyStateLink>
      )}
    </EmptyState>
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  return <PageCrumbs items={[{ label: result.ok ? result.office.name : "Sede" }]} />;
}
