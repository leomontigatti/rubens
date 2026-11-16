import { Link, createFileRoute } from "@tanstack/react-router";

import { activeRecord } from "#/components/admin-form.tsx";
import {
  changeRoomActive,
  editRoom,
  getOfficeWithRooms,
  getRoomUpcomingCount,
} from "#/server/offices.functions.ts";

import { RoomForm } from "#/routes/_app/sedes/-room-form.tsx";
import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId_/consultorios/$roomId")({
  loader: ({ params }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, includeInactive: true } }),
  head: () => ({ meta: [{ title: "Editar consultorio · underthing" }] }),
  staticData: { crumbs: Crumbs },
  component: EditRoom,
});

function EditRoom() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { officeId, roomId } = Route.useParams();
  const toggle = useAction();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const room = result.rooms.find((one) => one.id === roomId);
  if (!room) {
    return <RefusalAlert reason="notFound" />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  return (
    <RoomForm
      officeId={officeId}
      title="Editar consultorio"
      description={room.name}
      initial={room}
      submitLabel="Guardar"
      record={activeRecord({
        active: room.active,
        inactiveLabel: "Inactivo",
        toggle,
        onChange: (active) =>
          void toggle.run(() => changeRoomActive({ data: { id: roomId, active } })),
        deactivation: {
          question: `¿Desactivar ${room.name}?`,
          countUpcoming: () => getRoomUpcomingCount({ data: { id: roomId } }),
        },
      })}
      onSubmit={(fields) => editRoom({ data: { ...fields, roomId } })}
    />
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  const { officeId } = Route.useParams();
  return (
    <PageCrumbs
      items={[
        {
          label: result.ok ? result.office.name : "Sede",
          link: (
            <Link
              to="/sedes/$officeId"
              params={{ officeId }}
              search={{ seccion: "consultorios" }}
            />
          ),
        },
        { label: "Editar consultorio" },
      ]}
    />
  );
}
