import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { editInsurer, getInsurers } from "#/server/insurers.functions.ts";

import { InsurerForm, refusalMessages } from "#/routes/_app/obras-sociales/-insurer-form.tsx";

export const Route = createFileRoute("/_app/obras-sociales/$insurerId")({
  loader: () => getInsurers({ data: { includeInactive: true } }),
  head: () => ({ meta: [{ title: "Editar obra social o prepaga · Rubens" }] }),
  component: EditInsurer,
});

function EditInsurer() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { insurerId } = Route.useParams();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const insurer = result.insurers.find((one) => one.id === insurerId);
  if (!insurer) {
    return <RefusalMessage message={refusalMessages.notFound} />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <InsurerForm
      title="Editar obra social o prepaga"
      description={insurer.name}
      initial={insurer}
      submitLabel="Guardar"
      onSubmit={(input) => editInsurer({ data: { ...input, insurerId } })}
    />
  );
}
