import { createFileRoute } from "@tanstack/react-router";

import { recordHead } from "#/lib/page-title.ts";
import { activeRecord, RefusalMessage } from "#/components/admin-form.tsx";
import { changeInsurerActive, editInsurer, getInsurers } from "#/server/insurers.functions.ts";

import {
  InsurerForm,
  refusalMessages,
  useAction,
} from "#/routes/_app/obras-sociales/-insurer-form.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/obras-sociales/$insurerId")({
  loader: () => getInsurers({ data: { includeInactive: true } }),
  head: ({ loaderData, params }) =>
    recordHead(
      loaderData?.ok ? loaderData.insurers : undefined,
      params.insurerId,
      (one) => one.name,
      "Obra social o prepaga",
    ),
  staticData: { crumbs: Crumbs },
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
      title={insurer.name}
      description="Los datos de la obra social o prepaga."
      initial={insurer}
      submitLabel="Guardar"
      record={activeRecord({
        active: insurer.active,
        ending: "a",
        archived: {
          title: "Obra social o prepaga archivada",
          consequence:
            "No se puede cargar en coberturas nuevas. Las coberturas que ya la tienen la conservan.",
        },
        transitionId: insurerId,
        toggle,
        onChange: (active) =>
          void toggle.run(() => changeInsurerActive({ data: { id: insurerId, active } })),
      })}
      onSubmit={(input) => editInsurer({ data: { ...input, insurerId } })}
    />
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  const { insurerId } = Route.useParams();
  const insurer = result.ok ? result.insurers.find((one) => one.id === insurerId) : undefined;
  return <PageCrumbs items={[{ label: insurer?.name ?? "Obra social o prepaga" }]} />;
}
