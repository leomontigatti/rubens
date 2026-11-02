import { createFileRoute } from "@tanstack/react-router";

import { addRoom } from "#/server/offices.functions.ts";

import { RoomForm } from "#/routes/_app/sedes/-room-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId_/consultorios/nuevo")({
  head: () => ({ meta: [{ title: "Nuevo consultorio · Rubens" }] }),
  component: NewRoom,
});

const newRoom = { name: "", capacity: 1 };

function NewRoom() {
  const { viewer } = Route.useRouteContext();
  const { officeId } = Route.useParams();
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  return (
    <RoomForm
      officeId={officeId}
      title="Nuevo consultorio"
      initial={newRoom}
      submitLabel="Crear consultorio"
      onSubmit={(fields) => addRoom({ data: { ...fields, officeId } })}
    />
  );
}
