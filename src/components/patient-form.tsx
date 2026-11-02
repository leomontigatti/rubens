import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useReducer, useState } from "react";
import type { FormEvent } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { DocumentTakenAlert, DuplicateWarning } from "#/components/patient-duplicates.tsx";
import {
  initialSaveState,
  patientRefusalMessages,
  saveReducer,
} from "#/components/patient-save.ts";
import { patientSearchQueries } from "#/components/patient-search.ts";
import type { RefusalState, SaveResult } from "#/components/patient-save.ts";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { documentTypeLabels, documentTypes, patientInputSchema } from "#/lib/patients.ts";
import type { DocumentType, DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
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
      if (result.ok) {
        await Promise.all([
          router.invalidate(),
          queryClient.invalidateQueries({ queryKey: patientSearchQueries }),
        ]);
      }
    } finally {
      dispatch({ type: "settled" });
    }
    if (!result.ok) {
      dispatch({ type: "refused", result });
      return;
    }
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

const noPatient = {
  firstName: "",
  lastName: "",
  phone: "",
  chosenName: "",
  documentType: "",
  documentNumber: "",
  birthDate: "",
  email: "",
  address: "",
};

/** What the form opens with: nothing for a registration, the patient's data for an edit. */
function patientValues(initial?: Patient): typeof noPatient {
  if (!initial) {
    return noPatient;
  }
  const held = Object.keys(noPatient).map((key) => [
    key,
    initial[key as keyof typeof noPatient] ?? "",
  ]);
  return { ...(Object.fromEntries(held) as typeof noPatient), phone: formatPhone(initial.phone) };
}

/**
 * A patient's form. `onSubmit` gets the input as typed, the empty document type
 * as none: the schema, on both sides, checks it.
 */
export function usePatientForm(
  initial: Patient | undefined,
  onSubmit: (input: PatientInput) => Promise<unknown>,
) {
  return useAppForm({
    defaultValues: patientValues(initial),
    onSubmit: ({ value }) =>
      onSubmit({ ...value, documentType: (value.documentType || null) as DocumentType | null }),
  });
}

/** A patient's or a guardian's phone. */
export const phoneFieldProps = {
  label: "Teléfono",
  type: "tel",
  required: true,
  hint: "Con código de área, como se dice: 0351 15 555-1234. Del exterior, con + y el código del país.",
};

export const documentTypeOptions = (
  <>
    <NativeSelectOption value="">Sin documento</NativeSelectOption>
    {documentTypes.map((type) => (
      <NativeSelectOption key={type} value={type}>
        {documentTypeLabels[type]}
      </NativeSelectOption>
    ))}
  </>
);

/** The registration inputs: the names and the phone always, the rest when `full`. */
export function PatientFields(props: { form: ReturnType<typeof usePatientForm>; full: boolean }) {
  const { form } = props;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="firstName">
          {(field) => <field.TextField label="Nombre" required />}
        </form.AppField>
        <form.AppField name="lastName">
          {(field) => <field.TextField label="Apellido" required />}
        </form.AppField>
      </div>
      <form.AppField name="phone">
        {(field) => <field.TextField {...phoneFieldProps} />}
      </form.AppField>
      {props.full && (
        <>
          <form.AppField name="chosenName">
            {(field) => (
              <field.TextField
                label="Nombre autopercibido"
                hint="Si la persona usa otro nombre, la app la llama así."
              />
            )}
          </form.AppField>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="documentType">
              {(field) => (
                <field.SelectField label="Tipo de documento">
                  {documentTypeOptions}
                </field.SelectField>
              )}
            </form.AppField>
            <form.AppField name="documentNumber">
              {(field) => <field.TextField label="Número de documento" />}
            </form.AppField>
          </div>
          <form.AppField name="birthDate">
            {(field) => <field.TextField label="Fecha de nacimiento" type="date" />}
          </form.AppField>
          <form.AppField name="email">
            {(field) => <field.TextField label="Correo electrónico" type="email" />}
          </form.AppField>
          <form.AppField name="address">
            {(field) => <field.TextField label="Dirección" />}
          </form.AppField>
        </>
      )}
    </div>
  );
}

/** The submit step of registering a patient, for its page and for the booking's picker. */
function usePatientRegistration(onRegistered: (patient: Patient) => void) {
  const save = usePatientSave(
    (data: PatientInput & DuplicateConfirmation) => addPatient({ data }),
    onRegistered,
  );
  const form = usePatientForm(undefined, async (raw) => {
    const parsed = patientInputSchema.safeParse(raw);
    if (!parsed.success) {
      save.setError(patientFieldMessage(parsed.error));
      return;
    }
    await save.submit(raw);
  });

  return { save, form };
}

/**
 * A name and a phone, so a first booking by phone takes seconds, or the whole
 * record when the patient is in front of reception.
 */
function RegistrationFields({ form }: { form: ReturnType<typeof usePatientForm> }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <PatientFields form={form} full={full} />
      {!full && (
        <div>
          <Button type="button" variant="link" onClick={() => setFull(true)}>
            Agregar más datos
          </Button>
        </div>
      )}
    </>
  );
}

/** Registers a patient inside another form's flow. */
export function PatientRegistrationForm(props: {
  onRegistered: (patient: Patient) => void;
  /** The user picked an existing patient the duplicate warning offered. */
  onUseExisting: (patient: Patient) => void;
  onCancel: () => void;
}) {
  const { save, form } = usePatientRegistration(props.onRegistered);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.handleSubmit();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <PatientSaveFeedback save={save} confirmLabel="Registrar igual" onUse={props.onUseExisting} />
      <RegistrationFields form={form} />
      <FormActions
        pending={save.pending}
        submitLabel="Registrar paciente"
        onCancel={props.onCancel}
      />
    </form>
  );
}

/** Registers a patient on a page of its own; `Nuevo paciente` then opens their record. */
export function PatientRegistrationPage() {
  const page = useFormPage({ to: "/pacientes" });
  const showPatient = (patient: Patient) =>
    page.leave({ to: "/pacientes/$patientId", params: { patientId: patient.id } });
  const { save, form } = usePatientRegistration(showPatient);
  return (
    <FormPage
      page={page}
      form={form}
      title="Nuevo paciente"
      submitLabel="Registrar paciente"
      pending={save.pending}
      onDiscard={save.dismiss}
    >
      <PatientSaveFeedback save={save} confirmLabel="Registrar igual" onUse={showPatient} />
      <RegistrationFields form={form} />
    </FormPage>
  );
}
