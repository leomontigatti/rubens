import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";
import { addMedicalService, getMedicalServices } from "#/server/medical-services.functions.ts";

import { MedicalServiceForm } from "#/routes/_app/prestaciones/-medical-service-form.tsx";
import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/$practitionerId_/nueva")({
  loader: ({ params }) =>
    getMedicalServices({ data: { practitionerId: params.practitionerId, includeInactive: false } }),
  head: () => ({ meta: [{ title: "Nueva prestación · underthing" }] }),
  component: NewMedicalService,
});

const newMedicalService: MedicalServiceFields = {
  name: "",
  durationMinutes: 30,
  templateIds: [],
  rescheduleCutoffHours: 24,
};

function NewMedicalService() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  if (!result.canEdit) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  const { practitioner } = result;
  return (
    <MedicalServiceForm
      practitionerId={practitioner.id}
      title="Nueva prestación"
      description={practitioner.displayName}
      initial={newMedicalService}
      templates={result.templates}
      submitLabel="Crear"
      creates
      onSubmit={(fields) =>
        addMedicalService({ data: { ...fields, practitionerId: practitioner.id } })
      }
    />
  );
}
