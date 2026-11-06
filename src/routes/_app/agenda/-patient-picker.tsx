import { useState } from "react";
import type { ComponentType } from "react";

import type { ComboboxFieldProps, ComboboxSearch } from "#/components/app-form.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import {
  patientSearchMatches,
  patientSearchMore,
  patientSearchProblem,
} from "#/components/patient-search.ts";
import { Button } from "#/components/ui/button.tsx";
import { usePatientSearch } from "#/components/use-patient-search.ts";
import type { PickedPatient } from "#/lib/booking-draft.ts";
import { patientName } from "#/lib/patients.ts";
import type { Patient } from "#/organization/patients.ts";

const picked = (patient: Patient): PickedPatient => ({
  id: patient.id,
  name: patientName(patient),
});

/** The patients the text in the box finds, as the combobox lists them. */
function usePatientMatches(query: string): ComboboxSearch<PickedPatient> {
  const search = usePatientSearch(query);
  return {
    items: patientSearchMatches(search)?.map(picked),
    waiting: search.waiting,
    problem: patientSearchProblem(search),
    note: patientSearchMore(search),
  };
}

/** Booking's `patient` field, from `form.AppField`. */
interface PatientField {
  state: { value: PickedPatient | null };
  handleChange: (patient: PickedPatient | null) => void;
  ComboboxField: ComponentType<ComboboxFieldProps<PickedPatient>>;
}

/**
 * Finds the patient with the search box, or registers one on the spot. A refusal
 * about the patient (inactive since) shows under the box, which takes the focus.
 */
export function PatientPicker(props: { field: PatientField }) {
  const { field } = props;
  const [registering, setRegistering] = useState(false);

  function registered(patient: Patient) {
    setRegistering(false);
    field.handleChange(picked(patient));
  }

  if (registering) {
    return (
      <PatientRegistrationForm
        onRegistered={registered}
        onUseExisting={registered}
        onCancel={() => setRegistering(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <field.ComboboxField
        label="Paciente"
        placeholder="Buscar por nombre, documento o teléfono"
        clearLabel="Borrar paciente"
        emptyText="Ningún paciente coincide con la búsqueda."
        useSearch={usePatientMatches}
        itemLabel={(patient) => patient.name}
        itemKey={(patient) => patient.id}
      />
      {/* Only with no patient picked: registering hides the box, and a hidden pick would still book. */}
      {!field.state.value && (
        <div>
          <Button type="button" variant="link" onClick={() => setRegistering(true)}>
            Registrar paciente nuevo
          </Button>
        </div>
      )}
    </div>
  );
}
