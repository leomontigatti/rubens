import { Link } from "@tanstack/react-router";

import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";
import { patientName } from "#/lib/patients.ts";

/** A patient's page, linked, then the step a page under it takes. */
export function PatientStepCrumbs(props: {
  patientId: string;
  patient: Parameters<typeof patientName>[0] | null;
  step: string;
  /** The patient's tab the step hangs off, which their link opens. */
  section: "coberturas" | "responsables";
}) {
  return (
    <PageCrumbs
      items={[
        {
          label: props.patient ? patientName(props.patient) : "Paciente",
          link: (
            <Link
              to="/pacientes/$patientId"
              params={{ patientId: props.patientId }}
              search={{ seccion: props.section }}
            />
          ),
        },
        { label: props.step },
      ]}
    />
  );
}
