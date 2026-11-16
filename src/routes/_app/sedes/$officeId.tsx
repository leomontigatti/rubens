import { BuildingIcon, PlusIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { ActiveBadge, activeRecord } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { showsAllPick, statusFilter } from "#/components/filter-groups.ts";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RecordName } from "#/components/record-transition.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { capacityLabel } from "#/lib/offices.ts";
import {
  changeOfficeActive,
  editOffice,
  getOfficeUpcomingCount,
  getOfficeWithRooms,
} from "#/server/offices.functions.ts";
import type { Office, Room } from "#/organization/offices.ts";

import { OfficeForm } from "#/routes/_app/sedes/-office-form.tsx";
import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

/** The page's subtitle, the same for every office and every role. */
const officeDescription = "Los datos de la sede y los consultorios donde se atiende.";

/** The page's tabs: the office's own data, and its rooms. */
const sections = ["datos", "consultorios"] as const;
type Section = (typeof sections)[number];

export const Route = createFileRoute("/_app/sedes/$officeId")({
  validateSearch: z.object({
    inactivos: z.boolean().optional().catch(undefined),
    seccion: z.enum(sections).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivos ?? false }),
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
  const rooms = <OfficeRooms office={result.office} rooms={result} isAdmin={isAdmin} />;
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <OfficeHeading office={result.office} />
        {rooms}
      </div>
    );
  }
  const activeRooms = result.rooms.filter((room) => room.active).length;
  return <EditOffice office={result.office} rooms={rooms} activeRooms={activeRooms} />;
}

/** The office's rooms list; an admin creates one from the page's `Acciones`. */
function OfficeRooms(props: {
  office: Office;
  rooms: { rooms: Room[]; onlyInactive: boolean };
  isAdmin: boolean;
}) {
  const { office, isAdmin } = props;
  return (
    <RoomTable
      officeId={office.id}
      rooms={props.rooms.rooms}
      onlyInactive={props.rooms.onlyInactive}
      isAdmin={isAdmin}
      canAdd={isAdmin && office.active}
    />
  );
}

/**
 * An admin's office page: titled by the office, with its state and
 * deactivation beside the name, and two tabs, the same form as a new
 * office's and its rooms.
 */
function EditOffice(props: { office: Office; rooms: ReactNode; activeRooms: number }) {
  const { office, rooms } = props;
  const toggle = useAction();
  // The URL picks the tab a page opens on (a room's pages come back to
  // `Consultorios`); a click switches it here, since a navigation would ask
  // before discarding an unsaved edit.
  const { seccion = "datos" } = Route.useSearch();
  const [section, setSection] = useState<Section>(seccion);
  const active = activeRecord({
    active: office.active,
    inactiveLabel: "Inactiva",
    toggle,
    onChange: (next) =>
      void toggle.run(() => changeOfficeActive({ data: { id: office.id, active: next } })),
    deactivation: {
      question: `¿Desactivar ${office.name}?`,
      countUpcoming: () => getOfficeUpcomingCount({ data: { id: office.id } }),
    },
    menu: {
      items: office.active && (
        <DropdownMenuItem
          render={
            <Link to="/sedes/$officeId/consultorios/nuevo" params={{ officeId: office.id }} />
          }
        >
          <PlusIcon />
          Nuevo consultorio
        </DropdownMenuItem>
      ),
    },
  });
  const record = {
    ...active,
    status: <ActiveBadge active={office.active} ending="a" />,
    transitionId: office.id,
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
        <Tabs value={section} onValueChange={(value: Section) => setSection(value)}>
          <TabsList className="w-full">
            <TabsTrigger value="datos">Datos generales</TabsTrigger>
            <TabsTrigger value="consultorios">
              Consultorios
              <Badge variant="outline">{props.activeRooms}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="datos" keepMounted>
            {form}
          </TabsContent>
          <TabsContent value="consultorios">{rooms}</TabsContent>
        </Tabs>
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
      status={<ActiveBadge active={office.active} ending="a" />}
      description={officeDescription}
    />
  );
}

/** A room in the list, and whether the viewer may open its page. */
type ListedRoom = Room & { canOpen: boolean };

const columns: DataTableColumn<ListedRoom>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (room) => (
      <RowName
        name={room.name}
        link={
          room.canOpen
            ? {
                to: "/sedes/$officeId/consultorios/$roomId",
                params: { officeId: room.officeId, roomId: room.id },
              }
            : undefined
        }
        status={<ActiveBadge active={room.active} ending="o" />}
      />
    ),
  },
  { id: "capacity", header: "Capacidad", cell: (room) => capacityLabel(room.capacity) },
];

function RoomTable(props: {
  officeId: string;
  rooms: Room[];
  onlyInactive: boolean;
  isAdmin: boolean;
  canAdd: boolean;
}) {
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
    void navigate({ search: (prev) => ({ ...prev, inactivos: showsAllPick(value) }) });

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
      noRecords={rooms.length === 0}
      empty={
        rooms.length === 0 ? (
          <NoRooms
            officeId={props.officeId}
            onlyInactive={props.onlyInactive}
            canAdd={props.canAdd}
          />
        ) : (
          <NoMatches icon={BuildingIcon} />
        )
      }
    />
  );
}

/** The office's room list with no records, or none active. */
function NoRooms(props: { officeId: string; onlyInactive: boolean; canAdd: boolean }) {
  return (
    <EmptyState
      icon={BuildingIcon}
      title={props.onlyInactive ? "Sin consultorios activos" : "Sin consultorios"}
      description={
        props.onlyInactive
          ? `No hay consultorios activos. ${props.canAdd ? "Empezá creando uno, o mirá" : "Mirá"} los inactivos.`
          : `Todavía no hay consultorios.${props.canAdd ? " Empezá creando el primero." : ""}`
      }
    >
      {props.canAdd && (
        <CreateButton
          link={
            <Link to="/sedes/$officeId/consultorios/nuevo" params={{ officeId: props.officeId }} />
          }
        >
          Nuevo consultorio
        </CreateButton>
      )}
      {props.onlyInactive && (
        <EmptyStateLink
          variant={props.canAdd ? "outline" : "default"}
          link={
            <Link
              to="/sedes/$officeId"
              params={{ officeId: props.officeId }}
              search={{ inactivos: true, seccion: "consultorios" }}
            />
          }
        >
          Ver inactivos
        </EmptyStateLink>
      )}
    </EmptyState>
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  return <PageCrumbs items={[{ label: result.ok ? result.office.name : "Sede" }]} />;
}
