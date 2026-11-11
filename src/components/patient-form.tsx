import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions } from "#/components/admin-form.tsx";
import { FormGrid, FormProblemsContext, useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { FieldDescription, FieldLegend } from "#/components/ui/field.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, focusProblem, useFormPage } from "#/components/form-page.tsx";
import { DocumentTakenAlert, DuplicateWarning } from "#/components/patient-duplicates.tsx";
import { initialSaveState, saveReducer } from "#/components/patient-save.ts";
import { patientSearchQueries } from "#/components/patient-search.ts";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import type { RefusalState, SaveResult } from "#/components/patient-save.ts";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { documentTypeLabels, documentTypes, patientInputSchema } from "#/lib/patients.ts";
import type { DocumentType, DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { addPatient } from "#/server/patients.functions.ts";
import type { Patient } from "#/organization/patients.ts";

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
    let result: SaveResult | null;
    try {
      result = await serverAnswer("patient-save", shownPath(router), () =>
        send({ ...next, confirmDuplicates }),
      );
      if (result?.ok) {
        await Promise.all([
          router.invalidate(),
          queryClient.invalidateQueries({ queryKey: patientSearchQueries }),
        ]);
      }
    } finally {
      dispatch({ type: "settled" });
    }
    if (!result) {
      return;
    }
    if (!result.ok) {
      dispatch({ type: "refused", result });
      return;
    }
    onSaved(result.patient);
  }

  return {
    ...state,
    submit: (next: I) => save(next, false),
    confirm: () => state.input && save(state.input, true),
    dismiss: () => dispatch({ type: "dismissed" }),
  };
}

/** What a save refused, and the number field a taken document marks. */
export function patientRefusals(save: RefusalState): FieldProblem[] {
  const refusals: FieldProblem[] = save.error ? [{ field: "", message: save.error }] : [];
  return save.holder
    ? [...refusals, { field: "documentNumber", message: documentTaken }]
    : refusals;
}

/** The document refusal and the duplicate warning of a patient form. */
export function PatientSaveFeedback(props: {
  save: RefusalState & { pending: boolean; confirm: () => unknown; dismiss: () => void };
  confirmLabel: string;
  onUse: (patient: Patient) => void;
}) {
  const { save } = props;
  return (
    <>
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

const documentTaken = "Ese documento ya está registrado.";

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

/** The copy for a patient's or guardian's field: the phone and the document carry their own. */
export const patientMessage = (issue: z.core.$ZodIssue) =>
  fieldMessages[issue.message] ?? messageIn(fieldMessages)(issue);

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

/**
 * The registration inputs: the names and the phone always, the rest when
 * `full`. They are rows of a `FormGrid`.
 */
export function PatientFields(props: { form: ReturnType<typeof usePatientForm>; full: boolean }) {
  const { form } = props;
  return (
    <>
      <form.AppField name="firstName">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="lastName">
        {(field) => <field.TextField label="Apellido" required />}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => <field.TextField {...phoneFieldProps} />}
      </form.AppField>
      {props.full && (
        <FormGrid>
          <div className="flex flex-col gap-1">
            <FieldLegend className="mb-0">Datos para completar</FieldLegend>
            <FieldDescription>
              Se pueden cargar ahora o en la primera visita. Mientras falte la fecha de nacimiento,
              el paciente figura con datos incompletos.
            </FieldDescription>
          </div>
          <form.AppField name="chosenName">
            {(field) => (
              <field.TextField
                label="Nombre autopercibido"
                hint="Si la persona usa otro nombre, la app la llama así."
              />
            )}
          </form.AppField>
          <form.AppField name="documentType">
            {(field) => (
              <field.SelectField label="Tipo de documento" startsRow>
                {documentTypeOptions}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField name="documentNumber">
            {(field) => <field.TextField label="Número de documento" />}
          </form.AppField>
          <form.AppField name="birthDate">
            {(field) => <field.TextField label="Fecha de nacimiento" type="date" startsRow />}
          </form.AppField>
          <form.AppField name="email">
            {(field) => <field.TextField label="Correo electrónico" type="email" startsRow />}
          </form.AppField>
          <form.AppField name="address">
            {(field) => <field.TextField label="Dirección" />}
          </form.AppField>
        </FormGrid>
      )}
    </>
  );
}

/** The submit step of registering a patient, for its page and for the booking's picker. */
function usePatientRegistration(
  onRegistered: (patient: Patient) => void,
  showProblems: (problems: FieldProblem[]) => void,
) {
  const save = usePatientSave(
    (data: PatientInput & DuplicateConfirmation) => addPatient({ data }),
    onRegistered,
  );
  const form = usePatientForm(undefined, async (raw) => {
    const parsed = patientInputSchema.safeParse(raw);
    if (!parsed.success) {
      showProblems(fieldProblems(parsed.error.issues, patientMessage));
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
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const { save, form } = usePatientRegistration(props.onRegistered, setProblems);
  const element = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(
    () => focusProblem(element.current, alert.current),
    [problems, save.holder, save.error],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblems([]);
    save.dismiss();
    void form.handleSubmit();
  }

  return (
    <form ref={element} method="post" className="flex flex-col gap-4" onSubmit={submit} noValidate>
      {save.error && (
        <div ref={alert} tabIndex={-1} className="outline-none">
          <ErrorAlert message={save.error} />
        </div>
      )}
      <PatientSaveFeedback save={save} confirmLabel="Registrar igual" onUse={props.onUseExisting} />
      <FormProblemsContext.Provider value={[...problems, ...patientRefusals(save)]}>
        <FormGrid>
          <RegistrationFields form={form} />
        </FormGrid>
      </FormProblemsContext.Provider>
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
  const { save, form } = usePatientRegistration(showPatient, page.showProblems);
  return (
    <FormPage
      page={page}
      form={form}
      title="Nuevo paciente"
      submitLabel="Registrar paciente"
      creates
      pending={save.pending}
      refusals={patientRefusals(save)}
      onClear={save.dismiss}
    >
      <PatientSaveFeedback save={save} confirmLabel="Registrar igual" onUse={showPatient} />
      <RegistrationFields form={form} />
    </FormPage>
  );
}
