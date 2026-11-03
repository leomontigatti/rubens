import { createFileRoute } from "@tanstack/react-router";

import { activeRecord, RefusalMessage } from "#/components/admin-form.tsx";
import { changeInsurerActive, editInsurer, getInsurers } from "#/server/insurers.functions.ts";

import {
  InsurerForm,
  refusalMessages,
  useAction,
} from "#/routes/_app/obras-sociales/-insurer-form.tsx";

export const Route = createFileRoute("/_app/obras-sociales/$insurerId")({
  loader: () => getInsurers({ data: { includeInactive: true } }),
  head: () => ({ meta: [{ title: "Editar obra social o prepaga · Rubens" }] }),
  component: EditInsurer,
});

function EditInsurer() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { insurerId } = Route.useParams();
  const toggle = useAction();
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
      record={activeRecord({
        active: insurer.active,
        inactiveLabel: "Inactiva",
        toggle,
        onChange: (active) =>
          void toggle.run(() => changeInsurerActive({ data: { id: insurerId, active } })),
      })}
      onSubmit={(input) => editInsurer({ data: { ...input, insurerId } })}
    />
  );
}
