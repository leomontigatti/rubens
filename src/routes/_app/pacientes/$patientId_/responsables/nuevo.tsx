import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { GuardianForm } from "#/components/patient-guardians.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { guardianInputSchema } from "#/lib/guardians.ts";
import { patientName } from "#/lib/patients.ts";
import { addPatientGuardian } from "#/server/guardians.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

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
      description={patientName(result.patient)}
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
  return (
    <PageCrumbs
      items={[
        {
          label: result.ok ? patientName(result.patient) : "Paciente",
          link: <Link to="/pacientes/$patientId" params={{ patientId }} />,
        },
        { label: "Agregar responsable" },
      ]}
    />
  );
}
