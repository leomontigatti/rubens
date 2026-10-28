import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useReducer, useState } from "react";
import type { FocusEvent, FormEvent } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions } from "#/components/admin-form.tsx";
import { DocumentTakenAlert, DuplicateWarning } from "#/components/patient-duplicates.tsx";
import {
  initialSaveState,
  patientRefusalMessages,
  saveReducer,
} from "#/components/patient-save.ts";
import { patientSearchQueries } from "#/components/patient-search.ts";
import type { RefusalState, SaveResult } from "#/components/patient-save.ts";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { documentTypeLabels, documentTypes, patientInputSchema } from "#/lib/patients.ts";
import type { DocumentType, DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";
import { formatPhone, parsePhone } from "#/lib/phones.ts";
import { addPatient } from "#/server/patients.functions.ts";
import type { Patient } from "#/server/patients.ts";

// The patient's registration fields, shared by quick registration (embedded
// by the patient list, and later by booking) and the patient page's edit.

/**
 * The submit step of the registration and edit forms. `send` saves the input;
 * a likely duplicate holds it back until `confirm` sends it again, confirmed.
 * Reloads the route's data and the patient searches, and calls `onSaved` once it is saved.
 */
export function usePatientSave<I extends object>(
  send: (input: I & DuplicateConfirmation) => Promise<SaveResult>,
  onSaved: (patient: Patient) => void,
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(saveReducer<I>, undefined, initialSaveState<I>);

  async function save(next: I, confirmDuplicates: boolean) {
    dispatch({ type: "sent", input: next });
    let result: SaveResult;
    try {
      result = await send({ ...next, confirmDuplicates });
    } finally {
      dispatch({ type: "settled" });
    }
    if (!result.ok) {
      dispatch({ type: "refused", result });
      return;
    }
    await Promise.all([
      router.invalidate(),
      queryClient.invalidateQueries({ queryKey: patientSearchQueries }),
    ]);
    onSaved(result.patient);
  }

  return {
    ...state,
    setError: (message: string) => dispatch({ type: "invalid", message }),
    submit: (next: I) => save(next, false),
    confirm: () => state.input && save(state.input, true),
    dismiss: () => dispatch({ type: "dismissed" }),
  };
}

/** The error, the document refusal and the duplicate warning of a patient form. */
export function PatientSaveFeedback(props: {
  save: RefusalState & { pending: boolean; confirm: () => unknown; dismiss: () => void };
  confirmLabel: string;
  onUse: (patient: Patient) => void;
}) {
  const { save } = props;
  return (
    <>
      <ErrorAlert message={save.error} />
      <DocumentTakenAlert holder={save.holder} />
      <DuplicateWarning
        candidates={save.candidates}
        confirmLabel={props.confirmLabel}
        pending={save.pending}
        onUse={props.onUse}
        onConfirm={() => void save.confirm()}
        onCancel={save.dismiss}
      />
    </>
  );
}

const fieldMessages: Record<string, string> = {
  firstName: "Ingresá el nombre.",
  lastName: "Ingresá el apellido.",
  chosenName: "El nombre autopercibido es demasiado largo.",
  documentType: "Elegí el tipo de documento.",
  documentNumber: "El número de documento es demasiado largo.",
  birthDate: "La fecha de nacimiento no es válida.",
  email: "El correo electrónico no es válido.",
  address: "La dirección es demasiado larga.",
  // A guardian's.
  name: "Ingresá el nombre.",
  relationship: "Ingresá la relación con el paciente.",
  // The phone and the document carry their own refusal as the issue's message.
  missingAreaCode: "Ingresá el teléfono con su código de área, por ejemplo 0351 15 555-1234.",
  invalidPhone: "El teléfono no es válido. Si es del exterior, empezá con + y el código del país.",
  documentIncomplete: "Elegí el tipo de documento e ingresá su número.",
  invalidDni: "El DNI tiene que ser un número, con o sin puntos.",
};

/** The copy for the first problem `error` names. */
export function patientFieldMessage(error: z.ZodError): string {
  const [issue] = error.issues;
  const field = String(issue!.path[0]);
  return (
    fieldMessages[issue!.message] ?? fieldMessages[field] ?? patientRefusalMessages.invalidInput
  );
}

/**
 * The fields `PatientFields` submitted. The type is only the select's value as
 * typed: the schema, on both sides, checks it.
 */
export function readPatientForm(form: FormData): PatientInput {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    firstName: text("firstName"),
    lastName: text("lastName"),
    phone: text("phone"),
    chosenName: text("chosenName"),
    documentType: (text("documentType") || null) as DocumentType | null,
    documentNumber: text("documentNumber"),
    birthDate: text("birthDate"),
    email: text("email"),
    address: text("address"),
  };
}

export function Field(props: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  hint?: string;
  /** A problem with what was typed, shown under the input. */
  error?: string | null;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onChange?: () => void;
}) {
  const errorId = props.error ? `${props.id}-error` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
        aria-invalid={Boolean(errorId)}
        aria-describedby={errorId}
        onBlur={props.onBlur}
        onChange={props.onChange}
      />
      <FieldNote id={`${props.id}-error`} hint={props.hint} error={props.error} />
    </div>
  );
}

/** The problem with a field's value when there is one, its hint otherwise. */
function FieldNote(props: { id: string; hint?: string; error?: string | null }) {
  if (props.error) {
    return (
      <p id={props.id} className="text-destructive text-sm">
        {props.error}
      </p>
    );
  }
  return props.hint ? <p className="text-muted-foreground text-sm">{props.hint}</p> : null;
}

const phoneHint =
  "Con código de área, como se dice: 0351 15 555-1234. Del exterior, con + y el código del país.";

/** The copy for a typed phone that cannot be a number, `null` when it can or is empty. */
function phoneProblem(input: string): string | null {
  const parsed = parsePhone(input);
  return input.trim() && !parsed.ok ? fieldMessages[parsed.reason]! : null;
}

/**
 * A patient's or a guardian's phone. A number that cannot be valid is refused
 * when the field loses focus, until it is changed; the submit checks it again.
 */
export function PhoneField(props: { id: string; defaultValue?: string | null }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Field
      id={props.id}
      name="phone"
      label="Teléfono"
      type="tel"
      defaultValue={props.defaultValue}
      required
      hint={phoneHint}
      error={error}
      onBlur={(event) => setError(phoneProblem(event.currentTarget.value))}
      onChange={() => setError(null)}
    />
  );
}

/** What the inputs start with: nothing for a registration, the patient's data for an edit. */
function formValues(initial: Patient | undefined): Partial<Patient> {
  return initial ? { ...initial, phone: formatPhone(initial.phone) } : {};
}

/** The optional document's type and number, a patient's or a guardian's. */
export function DocumentInputs(props: {
  idPrefix: string;
  initial: { documentType?: DocumentType | null; documentNumber?: string | null };
}) {
  const id = (name: string) => `${props.idPrefix}-${name}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor={id("documentType")}>Tipo de documento</Label>
        <NativeSelect
          id={id("documentType")}
          name="documentType"
          defaultValue={props.initial.documentType ?? ""}
        >
          <NativeSelectOption value="">Sin documento</NativeSelectOption>
          {documentTypes.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {documentTypeLabels[type]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <Field
        id={id("documentNumber")}
        name="documentNumber"
        label="Número de documento"
        defaultValue={props.initial.documentNumber}
      />
    </div>
  );
}

/**
 * The registration inputs: the names and the phone always, the rest when
 * `full`. `initial` fills them for an edit.
 */
export function PatientFields(props: { idPrefix: string; full: boolean; initial?: Patient }) {
  const values = formValues(props.initial);
  const id = (name: string) => `${props.idPrefix}-${name}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={id("firstName")}
          name="firstName"
          label="Nombre"
          defaultValue={values.firstName}
          required
        />
        <Field
          id={id("lastName")}
          name="lastName"
          label="Apellido"
          defaultValue={values.lastName}
          required
        />
      </div>
      <PhoneField id={id("phone")} defaultValue={values.phone} />
      {props.full && (
        <>
          <Field
            id={id("chosenName")}
            name="chosenName"
            label="Nombre autopercibido"
            defaultValue={values.chosenName}
            hint="Si la persona usa otro nombre, la app la llama así."
          />
          <DocumentInputs idPrefix={props.idPrefix} initial={values} />
          <Field
            id={id("birthDate")}
            name="birthDate"
            label="Fecha de nacimiento"
            type="date"
            defaultValue={values.birthDate}
          />
          <Field
            id={id("email")}
            name="email"
            label="Correo electrónico"
            type="email"
            defaultValue={values.email}
          />
          <Field
            id={id("address")}
            name="address"
            label="Dirección"
            defaultValue={values.address}
          />
        </>
      )}
    </div>
  );
}

/**
 * Registers a patient: a name and a phone, so a first booking by phone takes
 * seconds, or the whole record when the patient is in front of reception.
 */
export function PatientRegistrationForm(props: {
  onRegistered: (patient: Patient) => void;
  /** The user picked an existing patient the duplicate warning offered. */
  onUseExisting: (patient: Patient) => void;
  onCancel: () => void;
}) {
  const save = usePatientSave(
    (data: PatientInput & DuplicateConfirmation) => addPatient({ data }),
    props.onRegistered,
  );
  const [full, setFull] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = readPatientForm(new FormData(event.currentTarget));
    const parsed = patientInputSchema.safeParse(raw);
    if (!parsed.success) {
      save.setError(patientFieldMessage(parsed.error));
      return;
    }
    await save.submit(raw);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <PatientSaveFeedback save={save} confirmLabel="Registrar igual" onUse={props.onUseExisting} />
      <PatientFields idPrefix="new-patient" full={full} />
      {!full && (
        <div>
          <Button type="button" variant="link" onClick={() => setFull(true)}>
            Agregar más datos
          </Button>
        </div>
      )}
      <FormActions
        pending={save.pending}
        submitLabel="Registrar paciente"
        onCancel={props.onCancel}
      />
    </form>
  );
}
