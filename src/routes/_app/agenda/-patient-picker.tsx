import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { FieldProblemText, joinIds, useFieldProblem } from "#/components/app-form.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientSearchMatches, patientSearchProblem } from "#/components/patient-search.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "#/components/ui/combobox.tsx";
import { Field, FieldError, FieldLabel } from "#/components/ui/field.tsx";
import { InputGroupAddon } from "#/components/ui/input-group.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { usePatientSearch } from "#/components/use-patient-search.ts";
import type { PickedPatient } from "#/lib/booking-draft.ts";
import { patientBoxChange } from "#/routes/_app/agenda/-patient-box.ts";
import { patientName } from "#/lib/patients.ts";
import type { Patient } from "#/server/patients.ts";

const picked = (patient: Patient): PickedPatient => ({
  id: patient.id,
  name: patientName(patient),
});

/** Finds the patient with the search box, or registers one on the spot. */
export function PatientPicker(props: {
  value: PickedPatient | null;
  onChange: (patient: PickedPatient | null) => void;
}) {
  const [registering, setRegistering] = useState(false);

  function registered(patient: Patient) {
    setRegistering(false);
    props.onChange(picked(patient));
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
      <PatientCombobox value={props.value} onChange={props.onChange} />
      {/* Only with no patient picked: registering hides the box, and a hidden pick would still book. */}
      {!props.value && (
        <div>
          <Button type="button" variant="link" onClick={() => setRegistering(true)}>
            Registrar paciente nuevo
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The patient picked stays in the box. Typing searches the server, and the list
 * opens only on the answer to the text in the box. A refusal about the patient
 * (inactive since) shows under the box, which takes the focus.
 */
function PatientCombobox(props: {
  value: PickedPatient | null;
  onChange: (patient: PickedPatient | null) => void;
}) {
  const box = usePatientBox(props.value, props.onChange);
  const [open, setOpen] = useState(false);
  const search = usePatientSearch(box.query);
  const searchProblem = patientSearchProblem(search);
  const searchErrorId = searchProblem ? "patient-search-error" : undefined;
  const { problem, errorId, invalid } = useFieldProblem("patient");
  // A failed search marks the field like any problem of its own.
  const marked = invalid ?? (searchProblem ? true : undefined);
  const found = patientSearchMatches(search)?.map(picked);
  // The list takes the box's whole width, not the bare input's.
  const anchor = useComboboxAnchor();

  return (
    <Field data-invalid={marked}>
      <FieldLabel htmlFor="patient">Paciente</FieldLabel>
      <Combobox
        items={found ?? []}
        filter={null}
        value={props.value}
        onValueChange={props.onChange}
        inputValue={box.text}
        onInputValueChange={box.change}
        open={open && found !== undefined}
        onOpenChange={setOpen}
        itemToStringLabel={(patient) => patient.name}
        isItemEqualToValue={(patient, value) => patient.id === value.id}
      >
        <div ref={anchor}>
          <ComboboxInput
            id="patient"
            className="w-full"
            placeholder="Buscar por nombre, documento o teléfono"
            showTrigger={false}
            showClear={props.value !== null}
            clearLabel="Borrar paciente"
            aria-invalid={marked}
            aria-describedby={joinIds(errorId, searchErrorId)}
          >
            <InputGroupAddon>
              {search.waiting ? (
                <Spinner aria-label="Buscando" />
              ) : (
                <SearchIcon aria-hidden="true" />
              )}
            </InputGroupAddon>
          </ComboboxInput>
        </div>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Ningún paciente coincide con la búsqueda.</ComboboxEmpty>
          <ComboboxList>
            {(patient: PickedPatient) => (
              <ComboboxItem key={patient.id} value={patient}>
                {patient.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
      {searchProblem && <FieldError id={searchErrorId}>{searchProblem}</FieldError>}
    </Field>
  );
}

/** The box's text and what it searches for, as `patientBoxChange` moves them. */
function usePatientBox(value: PickedPatient | null, onChange: (patient: null) => void) {
  const [text, setText] = useState(value?.name ?? "");
  const [query, setQuery] = useState("");
  function change(next: string, { reason }: { reason: string }) {
    const moved = patientBoxChange(next, reason, value !== null);
    if (!moved) {
      return;
    }
    setText(moved.text);
    setQuery(moved.query);
    if (moved.dropPick) {
      onChange(null);
    }
  }
  return { text, query, change };
}
