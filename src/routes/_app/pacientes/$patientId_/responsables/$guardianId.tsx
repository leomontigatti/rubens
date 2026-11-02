import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { GuardianForm } from "#/components/patient-guardians.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { guardianUpdateSchema } from "#/lib/guardians.ts";
import { formatPhone } from "#/lib/phones.ts";
import { editGuardian, getGuardians } from "#/server/guardians.functions.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/responsables/$guardianId")({
  loader: ({ params }) => getGuardians({ data: { patientId: params.patientId } }),
  head: () => ({ meta: [{ title: "Editar responsable · Rubens" }] }),
  component: EditGuardian,
});

function EditGuardian() {
  const result = Route.useLoaderData();
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
      initial={{ ...guardian, phone: formatPhone(guardian.phone) }}
      submitLabel="Guardar"
      schema={guardianUpdateSchema}
      ids={{ guardianId }}
      onSubmit={(fields) => editGuardian({ data: { ...fields, guardianId } })}
    />
  );
}
