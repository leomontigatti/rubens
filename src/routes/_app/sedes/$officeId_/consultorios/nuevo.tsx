import { Link, createFileRoute } from "@tanstack/react-router";

import { addRoom, getOfficeWithRooms } from "#/server/offices.functions.ts";

import { RoomForm } from "#/routes/_app/sedes/-room-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId_/consultorios/nuevo")({
  loader: ({ params }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, includeInactive: false } }),
  head: () => ({ meta: [{ title: "Nuevo consultorio · underthing" }] }),
  staticData: { crumbs: Crumbs },
  component: NewRoom,
});

const newRoom = { name: "", capacity: 1 };

function NewRoom() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { officeId } = Route.useParams();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  if (!result.office.active) {
    return <RefusalAlert reason="officeInactive" />;
  }
  return (
    <RoomForm
      officeId={officeId}
      title="Nuevo consultorio"
      description={result.office.name}
      initial={newRoom}
      submitLabel="Crear consultorio"
      creates
      onSubmit={(fields) => addRoom({ data: { ...fields, officeId } })}
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
        { label: "Nuevo consultorio" },
      ]}
    />
  );
}
