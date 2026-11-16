import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PatientStepCrumbs } from "#/routes/_app/pacientes/-patient-crumbs.tsx";
import { GuardianForm } from "#/components/patient-guardians.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { guardianUpdateSchema } from "#/lib/guardians.ts";
import { editGuardian, getGuardians } from "#/server/guardians.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/responsables/$guardianId")({
  loader: async ({ params }) => {
    const data = { patientId: params.patientId };
    const [guardians, details] = await Promise.all([
      getGuardians({ data }),
      getPatientDetails({ data }),
    ]);
    return { guardians, details };
  },
  head: () => ({ meta: [{ title: "Editar responsable · underthing" }] }),
  staticData: { crumbs: Crumbs },
  component: EditGuardian,
});

function EditGuardian() {
  const { guardians: result } = Route.useLoaderData();
  const { patientId, guardianId } = Route.useParams();
  if (!result.ok) {
    return <RefusalMessage message={patientRefusalMessages.forbidden} />;
  }
  const guardian = result.guardians.find((one) => one.id === guardianId);
  if (!guardian) {
    return <RefusalMessage message="No encontramos ese responsable." />;
  }
  return (
    <GuardianForm
      patientId={patientId}
      title="Editar responsable"
      description={guardian.name}
      initial={guardian}
      submitLabel="Guardar"
      schema={guardianUpdateSchema}
      ids={{ guardianId }}
      onSubmit={(fields) => editGuardian({ data: { ...fields, guardianId } })}
    />
  );
}

function Crumbs() {
  const { details } = Route.useLoaderData();
  const { patientId } = Route.useParams();
  const patient = details.ok ? details.patient : null;
  return <PatientStepCrumbs patientId={patientId} patient={patient} step="Editar responsable" />;
}
