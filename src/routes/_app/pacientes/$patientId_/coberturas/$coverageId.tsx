import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { CoverageForm, offeredInsurers } from "#/components/patient-coverages.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { coverageLabel } from "#/lib/coverages.ts";
import { editCoverage, getCoverages } from "#/server/coverages.functions.ts";
import { getInsurers } from "#/server/insurers.functions.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/coberturas/$coverageId")({
  loader: async ({ params }) => {
    const [coverages, insurers] = await Promise.all([
      getCoverages({ data: { patientId: params.patientId } }),
      getInsurers({ data: { includeInactive: false } }),
    ]);
    return { coverages, insurers };
  },
  head: () => ({ meta: [{ title: "Editar cobertura · underthing" }] }),
  component: EditCoverage,
});

function EditCoverage() {
  const { coverages, insurers } = Route.useLoaderData();
  const { patientId, coverageId } = Route.useParams();
  if (!coverages.ok || !insurers.ok) {
    return <RefusalMessage message={patientRefusalMessages.forbidden} />;
  }
  const coverage = coverages.coverages.find((one) => one.id === coverageId);
  if (!coverage) {
    return <RefusalMessage message="No encontramos esa cobertura." />;
  }
  return (
    <CoverageForm
      patientId={patientId}
      title="Editar cobertura"
      description={coverageLabel(coverage)}
      initial={coverage}
      insurers={offeredInsurers(insurers.insurers, coverage)}
      submitLabel="Guardar"
      onSubmit={(fields) => editCoverage({ data: { ...fields, coverageId } })}
    />
  );
}
