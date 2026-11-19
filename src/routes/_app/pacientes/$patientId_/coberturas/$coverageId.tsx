import { createFileRoute } from "@tanstack/react-router";

import { PatientStepCrumbs } from "#/routes/_app/pacientes/-patient-crumbs.tsx";

import { RefusalMessage } from "#/components/admin-form.tsx";
import {
  CoverageForm,
  offeredInsurers,
  useCoverageRecord,
} from "#/components/patient-coverages.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { coverageLabel } from "#/lib/coverages.ts";
import { pageHead } from "#/lib/page-title.ts";
import { editCoverage, getCoverages } from "#/server/coverages.functions.ts";
import { getInsurers } from "#/server/insurers.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";
import type { Coverage } from "#/organization/coverages.ts";
import type { Insurer } from "#/organization/insurers.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/coberturas/$coverageId")({
  loader: async ({ params }) => {
    const data = { patientId: params.patientId };
    const [coverages, insurers, details] = await Promise.all([
      getCoverages({ data }),
      getInsurers({ data: { includeInactive: false } }),
      getPatientDetails({ data }),
    ]);
    return { coverages, insurers, details };
  },
  head: ({ loaderData, params }) => {
    const coverage =
      loaderData?.coverages.ok &&
      loaderData.coverages.coverages.find((one) => one.id === params.coverageId);
    return pageHead(coverage ? coverageLabel(coverage) : "Cobertura");
  },
  staticData: { crumbs: Crumbs },
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
  return <CoverageRecord patientId={patientId} coverage={coverage} insurers={insurers.insurers} />;
}

function CoverageRecord(props: { patientId: string; coverage: Coverage; insurers: Insurer[] }) {
  const { patientId, coverage } = props;
  const coverageId = coverage.id;
  const record = useCoverageRecord(patientId, coverage);
  return (
    <CoverageForm
      patientId={patientId}
      title={coverageLabel(coverage)}
      description="La obra social o prepaga del paciente y su número de afiliado."
      record={record}
      initial={coverage}
      insurers={offeredInsurers(props.insurers, coverage)}
      submitLabel="Guardar"
      onSubmit={(fields) => editCoverage({ data: { ...fields, coverageId } })}
    />
  );
}

function Crumbs() {
  const { details, coverages } = Route.useLoaderData();
  const { patientId, coverageId } = Route.useParams();
  const patient = details.ok ? details.patient : null;
  const coverage = coverages.ok && coverages.coverages.find((one) => one.id === coverageId);
  return (
    <PatientStepCrumbs
      patientId={patientId}
      patient={patient}
      step={coverage ? coverageLabel(coverage) : "Cobertura"}
      section="coberturas"
    />
  );
}
