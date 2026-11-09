import { createFileRoute } from "@tanstack/react-router";

import { editOffice, getOfficeWithRooms } from "#/server/offices.functions.ts";

import { OfficeForm } from "#/routes/_app/sedes/-office-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId_/editar")({
  loader: ({ params }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, includeInactive: false } }),
  head: () => ({ meta: [{ title: "Editar sede · underthing" }] }),
  component: EditOffice,
});

function EditOffice() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  const { office } = result;
  return (
    <OfficeForm
      title="Editar sede"
      description={office.name}
      initial={office}
      submitLabel="Guardar"
      onSubmit={(input) => editOffice({ data: { ...input, officeId: office.id } })}
    />
  );
}
