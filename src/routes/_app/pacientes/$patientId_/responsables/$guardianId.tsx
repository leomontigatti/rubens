import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PatientStepCrumbs } from "#/routes/_app/pacientes/-patient-crumbs.tsx";
import { GuardianForm, useGuardianRecord } from "#/components/patient-guardians.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { guardianUpdateSchema } from "#/lib/guardians.ts";
import { pageHead } from "#/lib/page-title.ts";
import { editGuardian, getGuardians } from "#/server/guardians.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";
import type { Guardian } from "#/organization/guardians.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/responsables/$guardianId")({
  loader: async ({ params }) => {
    const data = { patientId: params.patientId };
    const [guardians, details] = await Promise.all([
      getGuardians({ data }),
      getPatientDetails({ data }),
    ]);
    return { guardians, details };
  },
  head: ({ loaderData, params }) =>
    pageHead(
      (loaderData?.guardians.ok &&
        loaderData.guardians.guardians.find((one) => one.id === params.guardianId)?.name) ||
        "Responsable",
    ),
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
  return <GuardianRecord patientId={patientId} guardian={guardian} />;
}

function GuardianRecord({ patientId, guardian }: { patientId: string; guardian: Guardian }) {
  const guardianId = guardian.id;
  const record = useGuardianRecord(patientId, guardian);
  return (
    <GuardianForm
      patientId={patientId}
      title={guardian.name}
      description="Quién está a cargo del paciente y cómo ubicarlo."
      record={record}
      initial={guardian}
      submitLabel="Guardar"
      schema={guardianUpdateSchema}
      ids={{ guardianId }}
      onSubmit={(fields) => editGuardian({ data: { ...fields, guardianId } })}
    />
  );
}

function Crumbs() {
  const { details, guardians } = Route.useLoaderData();
  const { patientId, guardianId } = Route.useParams();
  const patient = details.ok ? details.patient : null;
  const guardian = guardians.ok && guardians.guardians.find((one) => one.id === guardianId);
  return (
    <PatientStepCrumbs
      patientId={patientId}
      patient={patient}
      step={guardian ? guardian.name : "Responsable"}
      section="responsables"
    />
  );
}
