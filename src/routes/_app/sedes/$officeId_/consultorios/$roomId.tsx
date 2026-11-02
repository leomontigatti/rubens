import { createFileRoute } from "@tanstack/react-router";

import { editRoom, getOfficeWithRooms } from "#/server/offices.functions.ts";

import { RoomForm } from "#/routes/_app/sedes/-room-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId_/consultorios/$roomId")({
  loader: ({ params }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, includeInactive: true } }),
  head: () => ({ meta: [{ title: "Editar consultorio · Rubens" }] }),
  component: EditRoom,
});

function EditRoom() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { officeId, roomId } = Route.useParams();
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
      onSubmit={(fields) => editRoom({ data: { ...fields, roomId } })}
    />
  );
}
