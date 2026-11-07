import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { CoverageForm } from "#/components/patient-coverages.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { Button } from "#/components/ui/button.tsx";
import { patientName } from "#/lib/patients.ts";
import { addPatientCoverage } from "#/server/coverages.functions.ts";
import { getInsurers } from "#/server/insurers.functions.ts";
import { getPatientDetails } from "#/server/patients.functions.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/coberturas/nueva")({
  loader: async ({ params }) => {
    const [details, insurers] = await Promise.all([
      getPatientDetails({ data: { patientId: params.patientId } }),
      getInsurers({ data: { includeInactive: false } }),
    ]);
    return { details, insurers };
  },
  head: () => ({ meta: [{ title: "Agregar cobertura · Rubens" }] }),
  component: NewCoverage,
});

const noInsurers =
  "No hay obras sociales ni prepagas activas. Un administrador las agrega en Obras sociales.";

function NewCoverage() {
  const { details, insurers } = Route.useLoaderData();
  const { patientId } = Route.useParams();
  if (!details.ok) {
    return <RefusalMessage message={patientRefusalMessages[details.reason]} />;
  }
  if (!insurers.ok || insurers.insurers.length === 0) {
    return (
      <div className="flex flex-col items-start gap-6">
        <PageHeader title="Agregar cobertura" />
        <p className="text-muted-foreground">{noInsurers}</p>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/pacientes/$patientId" params={{ patientId }} />}
        >
          Volver
        </Button>
      </div>
    );
  }
  return (
    <CoverageForm
      patientId={patientId}
      title="Agregar cobertura"
      description={patientName(details.patient)}
      initial={{ insurerId: "", plan: null, memberNumber: "" }}
      insurers={insurers.insurers}
      submitLabel="Agregar"
      creates
      onSubmit={(fields) => addPatientCoverage({ data: { ...fields, patientId } })}
    />
  );
}
