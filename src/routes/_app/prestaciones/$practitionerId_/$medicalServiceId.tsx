import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { editMedicalService, getMedicalServices } from "#/server/medical-services.functions.ts";

import { MedicalServiceForm } from "#/routes/_app/prestaciones/-medical-service-form.tsx";
import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/$practitionerId_/$medicalServiceId")({
  loader: ({ params }) =>
    getMedicalServices({ data: { practitionerId: params.practitionerId, includeInactive: true } }),
  head: () => ({ meta: [{ title: "Editar prestación · Rubens" }] }),
  component: EditMedicalService,
});

function EditMedicalService() {
  const result = Route.useLoaderData();
  const { medicalServiceId } = Route.useParams();
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
      title="Editar prestación"
      description={medicalService.name}
      initial={medicalService}
      submitLabel="Guardar"
      onSubmit={(fields) => editMedicalService({ data: { ...fields, medicalServiceId } })}
    />
  );
}
