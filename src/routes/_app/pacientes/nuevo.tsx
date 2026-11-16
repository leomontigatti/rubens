import { createFileRoute } from "@tanstack/react-router";

import { PatientRegistrationPage } from "#/components/patient-form.tsx";
import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/pacientes/nuevo")({
  head: () => ({ meta: [{ title: "Nuevo paciente · underthing" }] }),
  staticData: { crumbs: fixedCrumbs("Nuevo paciente") },
  component: PatientRegistrationPage,
});
