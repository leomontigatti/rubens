import { Link } from "@tanstack/react-router";

import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";
import { patientName } from "#/lib/patients.ts";

/** A patient's page, linked, then the step a page under it takes. */
export function PatientStepCrumbs(props: {
  patientId: string;
  patient: Parameters<typeof patientName>[0] | null;
  step: string;
}) {
  return (
    <PageCrumbs
      items={[
        {
          label: props.patient ? patientName(props.patient) : "Paciente",
          link: <Link to="/pacientes/$patientId" params={{ patientId: props.patientId }} />,
        },
        { label: props.step },
      ]}
    />
  );
}
