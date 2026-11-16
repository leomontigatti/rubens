import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { fieldProblems } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import {
  PatientFields,
  PatientSaveFeedback,
  patientMessage,
  patientRefusals,
  usePatientForm,
  usePatientSave,
} from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { patientName, patientUpdateSchema } from "#/lib/patients.ts";
import type { DuplicateConfirmation, PatientUpdate } from "#/lib/patients.ts";
import { editPatient, getPatientDetails } from "#/server/patients.functions.ts";
import type { Patient } from "#/organization/patients.ts";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/pacientes/$patientId_/editar")({
  loader: ({ params }) => getPatientDetails({ data: { patientId: params.patientId } }),
  head: () => ({ meta: [{ title: "Editar paciente · underthing" }] }),
  staticData: { crumbs: Crumbs },
  component: EditPatient,
});

function EditPatient() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={patientRefusalMessages[result.reason]} />;
  }
  return <PatientEditForm patient={result.patient} />;
}

function PatientEditForm({ patient }: { patient: Patient }) {
  const page = useFormPage({ to: "/pacientes/$patientId", params: { patientId: patient.id } });
  const save = usePatientSave(
    (data: PatientUpdate & DuplicateConfirmation) => editPatient({ data }),
    () => page.leave(),
  );

  const form = usePatientForm(patient, async (input) => {
    const update = { ...input, patientId: patient.id };
    const parsed = patientUpdateSchema.safeParse(update);
    if (!parsed.success) {
      page.showProblems(fieldProblems(parsed.error.issues, patientMessage));
      return;
    }
    await save.submit(update);
  });

  return (
    <FormPage
      page={page}
      form={form}
      title="Editar paciente"
      description={patientName(patient)}
      submitLabel="Guardar"
      pending={save.pending}
      refusals={patientRefusals(save)}
      onClear={save.dismiss}
    >
      <PatientSaveFeedback
        save={save}
        confirmLabel="Guardar igual"
        onUse={(other) =>
          page.leave({ to: "/pacientes/$patientId", params: { patientId: other.id } })
        }
      />
      <PatientFields form={form} full />
    </FormPage>
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
        { label: "Editar paciente" },
      ]}
    />
  );
}
