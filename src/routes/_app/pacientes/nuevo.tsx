import { createFileRoute } from "@tanstack/react-router";

import { PatientRegistrationPage } from "#/components/patient-form.tsx";

export const Route = createFileRoute("/_app/pacientes/nuevo")({
  head: () => ({ meta: [{ title: "Nuevo paciente · Rubens" }] }),
  component: PatientRegistrationPage,
});
