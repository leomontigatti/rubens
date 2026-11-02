import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { capacityLabel } from "#/lib/offices.ts";
import {
  changeRoomActive,
  getRoomUpcomingCount,
  getOfficeWithRooms,
} from "#/server/offices.functions.ts";
import type { Office, Room } from "#/server/offices.ts";
import { AdminControls, ErrorAlert } from "#/components/admin-form.tsx";

import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId")({
  validateSearch: z.object({ inactivos: z.boolean().optional() }),
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <OfficeHeading office={result.office} />
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Consultorios</h2>
        <ShowInactiveRooms />
      </div>
      <CreateButton
        can={isAdmin && result.office.active}
        link={<Link to="/sedes/$officeId/consultorios/nuevo" params={{ officeId }} />}
      >
        Nuevo consultorio
      </CreateButton>
      <RoomList rooms={result.rooms} isAdmin={isAdmin} canAdd={isAdmin && result.office.active} />
    </div>
  );
}

function OfficeHeading({ office }: { office: Office }) {
  return (
    <PageHeader
      back={{ to: "/sedes", label: "Sedes" }}
      title={office.name}
      status={!office.active && <Badge variant="secondary">Inactiva</Badge>}
      description={
        <p className="text-muted-foreground text-sm">
          {office.address} · {office.timeZone}
        </p>
      }
    />
  );
}

function ShowInactiveRooms() {
  const { inactivos } = Route.useSearch();
  const { officeId } = Route.useParams();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={
        <Link
          to="/sedes/$officeId"
          params={{ officeId }}
          search={{ inactivos: inactivos ? undefined : true }}
        />
      }
    >
      {inactivos ? "Ocultar inactivos" : "Mostrar inactivos"}
    </Button>
  );
}

function RoomList(props: { rooms: Room[]; isAdmin: boolean; canAdd: boolean }) {
  const { rooms, isAdmin } = props;
  const { inactivos } = Route.useSearch();
  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={BuildingIcon}
        title="No hay consultorios para mostrar"
        description={`Agregá uno con Nuevo consultorio${inactivos ? "" : ", o mirá los inactivos"}.`}
        canAct={props.canAdd}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rooms.map((room) => (
        <RoomItem key={room.id} room={room} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function RoomItem({ room, isAdmin }: { room: Room; isAdmin: boolean }) {
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {room.name}
              {!room.active && <Badge variant="secondary">Inactivo</Badge>}
            </span>
            <span className="text-muted-foreground text-sm">{capacityLabel(room.capacity)}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={room.active}
            editLink={
              <Link
                to="/sedes/$officeId/consultorios/$roomId"
                params={{ officeId: room.officeId, roomId: room.id }}
              />
            }
            deactivation={{
              question: `¿Desactivar ${room.name}?`,
              countUpcoming: () => getRoomUpcomingCount({ data: { id: room.id } }),
            }}
            onToggleActive={() =>
              void toggle.run(() =>
                changeRoomActive({ data: { id: room.id, active: !room.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}
