import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { GuardianForm } from "#/components/patient-guardians.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { guardianInputSchema } from "#/lib/guardians.ts";
import { addPatientGuardian } from "#/server/guardians.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";
import { PatientStepCrumbs } from "#/routes/_app/pacientes/-patient-crumbs.tsx";

export const Route = createFileRoute("/_app/pacientes/$patientId_/responsables/nuevo")({
  loader: ({ params }) => getPatientDetails({ data: { patientId: params.patientId } }),
  head: () => ({ meta: [{ title: "Agregar responsable · underthing" }] }),
  staticData: { crumbs: Crumbs },
  component: NewGuardian,
});

function NewGuardian() {
  const result = Route.useLoaderData();
  const { patientId } = Route.useParams();
  if (!result.ok) {
    return <RefusalMessage message={patientRefusalMessages[result.reason]} />;
  }
  return (
    <GuardianForm
      patientId={patientId}
      title="Agregar responsable"
      description="Quien acompaña al paciente y puede recibir sus mensajes."
      initial={{ name: "", relationship: "", phone: "" }}
      submitLabel="Agregar responsable"
      creates
      schema={guardianInputSchema}
      ids={{ patientId }}
      onSubmit={(fields) => addPatientGuardian({ data: { ...fields, patientId } })}
    />
  );
}

function Crumbs() {
  const result = Route.useLoaderData();
  const { patientId } = Route.useParams();
  const patient = result.ok ? result.patient : null;
  return (
    <PatientStepCrumbs
      patientId={patientId}
      patient={patient}
      step="Agregar responsable"
      section="responsables"
    />
  );
}
