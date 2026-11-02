import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import {
  PatientFields,
  PatientSaveFeedback,
  patientFieldMessage,
  readPatientForm,
  usePatientSave,
} from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { patientName, patientUpdateSchema } from "#/lib/patients.ts";
import type { DuplicateConfirmation, PatientUpdate } from "#/lib/patients.ts";
import { editPatient, getPatientDetails } from "#/server/patients.functions.ts";
import type { Patient } from "#/server/patients.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId_/editar")({
  loader: ({ params }) => getPatientDetails({ data: { patientId: params.patientId } }),
  head: () => ({ meta: [{ title: "Editar paciente · Rubens" }] }),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const update = { ...readPatientForm(new FormData(event.currentTarget)), patientId: patient.id };
    const parsed = patientUpdateSchema.safeParse(update);
    if (!parsed.success) {
      save.setError(patientFieldMessage(parsed.error));
      return;
    }
    await save.submit(update);
  }

  return (
    <FormPage
      page={page}
      title="Editar paciente"
      description={patientName(patient)}
      submitLabel="Guardar"
      pending={save.pending}
      onSubmit={(event) => void handleSubmit(event)}
      onDiscard={save.dismiss}
    >
      <PatientSaveFeedback
        save={save}
        confirmLabel="Guardar igual"
        onUse={(other) =>
          page.leave({ to: "/pacientes/$patientId", params: { patientId: other.id } })
        }
      />
      <PatientFields idPrefix={patient.id} full initial={patient} />
    </FormPage>
  );
}
