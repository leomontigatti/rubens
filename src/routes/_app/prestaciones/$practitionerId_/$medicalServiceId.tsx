import { Link, createFileRoute } from "@tanstack/react-router";

import { recordHead } from "#/lib/page-title.ts";
import { activeRecord, RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import {
  changeMedicalServiceActive,
  editMedicalService,
  getMedicalServices,
} from "#/server/medical-services.functions.ts";

import { MedicalServiceForm } from "#/routes/_app/prestaciones/-medical-service-form.tsx";
import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/prestaciones/$practitionerId_/$medicalServiceId")({
  loader: ({ params }) =>
    getMedicalServices({ data: { practitionerId: params.practitionerId, includeInactive: true } }),
  head: ({ loaderData, params }) =>
    recordHead(
      loaderData?.ok ? loaderData.medicalServices : undefined,
      params.medicalServiceId,
      (one) => one.name,
      "Prestación",
    ),
  staticData: { crumbs: Crumbs },
  component: EditMedicalService,
});

function EditMedicalService() {
  const result = Route.useLoaderData();
  const { medicalServiceId } = Route.useParams();
  const toggle = useFormAction(refusalMessages);
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const medicalService = result.medicalServices.find((one) => one.id === medicalServiceId);
  if (!medicalService) {
    return <RefusalMessage message={refusalMessages.notFound} />;
  }
  if (!result.canEdit) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <MedicalServiceForm
      practitionerId={result.practitioner.id}
      title={medicalService.name}
      description="Los datos de la prestación y los mensajes de WhatsApp que envía."
      initial={medicalService}
      templates={result.templates}
      submitLabel="Guardar"
      record={activeRecord({
        active: medicalService.active,
        ending: "a",
        archived: {
          title: "Prestación archivada",
          consequence: "No se pueden dar turnos con ella.",
        },
        transitionId: medicalServiceId,
        toggle,
        onChange: (active) =>
          void toggle.run(() =>
            changeMedicalServiceActive({ data: { id: medicalServiceId, active } }),
          ),
      })}
      onSubmit={(fields) => editMedicalService({ data: { ...fields, medicalServiceId } })}
    />
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  const { practitionerId } = Route.useParams();
  return (
    <PageCrumbs
      items={[
        {
          label: result.ok ? result.practitioner.displayName : "Profesional",
          link: <Link to="/prestaciones/$practitionerId" params={{ practitionerId }} />,
        },
        { label: "Editar prestación" },
      ]}
    />
  );
}
