import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import type { InsurerInput } from "#/lib/coverages.ts";
import { addInsurer } from "#/server/insurers.functions.ts";

import { InsurerForm, refusalMessages } from "#/routes/_app/obras-sociales/-insurer-form.tsx";

export const Route = createFileRoute("/_app/obras-sociales/nueva")({
  head: () => ({ meta: [{ title: "Nueva obra social o prepaga · underthing" }] }),
  component: NewInsurer,
});

const newInsurer: InsurerInput = { name: "", kind: "obraSocial" };

function NewInsurer() {
  const { viewer } = Route.useRouteContext();
  if (!viewer.roles.includes("admin")) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <InsurerForm
      title="Nueva obra social o prepaga"
      initial={newInsurer}
      submitLabel="Crear"
      creates
      onSubmit={(input) => addInsurer({ data: input })}
    />
  );
}
