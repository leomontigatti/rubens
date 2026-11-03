import { useState } from "react";

import { FieldProblemText, useFieldProblem } from "#/components/app-form.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientSearchProblem } from "#/components/patient-search.ts";
import { SearchInput } from "#/components/search-input.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Field, FieldError, FieldLabel } from "#/components/ui/field.tsx";
import { usePatientSearch } from "#/components/use-patient-search.ts";
import type { PatientSearch as Search } from "#/components/use-patient-search.ts";
import type { PickedPatient } from "#/lib/booking-draft.ts";
import { patientName } from "#/lib/patients.ts";
import type { Patient } from "#/server/patients.ts";

/** Finds the patient with the search box, or registers one on the spot. */
export function PatientPicker(props: {
  value: PickedPatient | null;
  onChange: (patient: PickedPatient | null) => void;
}) {
  const [registering, setRegistering] = useState(false);

  function choose(chosen: Patient | null) {
    setRegistering(false);
    props.onChange(chosen && { id: chosen.id, name: patientName(chosen) });
  }

  if (props.value) {
    return <PickedPatientLine patient={props.value} onChange={() => choose(null)} />;
  }
  if (registering) {
    return (
      <PatientRegistrationForm
        onRegistered={choose}
        onUseExisting={choose}
        onCancel={() => setRegistering(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PatientSearch onChoose={choose} />
      <div>
        <Button type="button" variant="link" onClick={() => setRegistering(true)}>
          Registrar paciente nuevo
        </Button>
      </div>
    </div>
  );
}

/**
 * The patient picked. A refusal about them (inactive since) shows here, and
 * `Cambiar` takes the focus, as the field to fix.
 */
function PickedPatientLine(props: { patient: PickedPatient; onChange: () => void }) {
  const { problem, errorId, invalid } = useFieldProblem("patient");
  return (
    <Field data-invalid={invalid}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Paciente:</span>{" "}
          <span className="font-medium">{props.patient.name}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onChange}
          aria-invalid={invalid}
          aria-describedby={errorId}
        >
          Cambiar
        </Button>
      </div>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

function PatientSearch(props: { onChoose: (patient: Patient) => void }) {
  const [query, setQuery] = useState("");
  const search = usePatientSearch(query);
  const { problem, errorId, invalid } = useFieldProblem("patient");

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor="patient">Paciente</FieldLabel>
      <SearchInput
        id="patient"
        placeholder="Buscar por nombre, documento o teléfono"
        value={query}
        onChange={setQuery}
        loading={search.waiting}
        aria-invalid={invalid}
        aria-describedby={errorId}
      />
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
      <PatientResults search={search} onChoose={props.onChoose} />
    </Field>
  );
}

/** Only the answer to the text in the box: nothing while it is on its way. */
function PatientResults(props: { search: Search; onChoose: (patient: Patient) => void }) {
  const problem = patientSearchProblem(props.search);
  if (problem) {
    return <FieldError>{problem}</FieldError>;
  }
  const { found } = props.search;
  return found?.ok ? <PatientList patients={found.patients} onChoose={props.onChoose} /> : null;
}

function PatientList(props: { patients: Patient[]; onChoose: (patient: Patient) => void }) {
  if (props.patients.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Ningún paciente coincide con la búsqueda.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {props.patients.map((patient) => (
        <li key={patient.id}>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onChoose(patient)}>
            {patientName(patient)}
          </Button>
        </li>
      ))}
    </ul>
  );
}
