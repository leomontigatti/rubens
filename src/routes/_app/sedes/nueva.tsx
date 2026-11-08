import { createFileRoute } from "@tanstack/react-router";

import { defaultTimeZone } from "#/lib/offices.ts";
import { addOffice } from "#/server/offices.functions.ts";

import { OfficeForm } from "#/routes/_app/sedes/-office-form.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/nueva")({
  head: () => ({ meta: [{ title: "Nueva sede · underthing" }] }),
  component: NewOffice,
});

const newOffice = { name: "", address: "", timeZone: defaultTimeZone };

function NewOffice() {
  const { viewer } = Route.useRouteContext();
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  return (
    <OfficeForm
      title="Nueva sede"
      initial={newOffice}
      submitLabel="Crear sede"
      creates
      onSubmit={(input) => addOffice({ data: input })}
    />
  );
}
