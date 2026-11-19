import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions } from "#/components/admin-form.tsx";
import { FormGrid, useAppForm } from "#/components/app-form.tsx";
import type { SelectOption } from "#/components/option-select.tsx";
import { FormProblemsContext } from "#/components/field-problem.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { DocumentTakenAlert, DuplicateWarning } from "#/components/patient-duplicates.tsx";
import { initialSaveState, saveReducer } from "#/components/patient-save.ts";
import { phoneMessages } from "#/components/phone-field.tsx";
import { patientSearchQueries } from "#/components/patient-search.ts";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import type { RefusalState, SaveResult } from "#/components/patient-save.ts";
import { Button } from "#/components/ui/button.tsx";
import { useFocusProblem } from "#/hooks/use-focus-problem.ts";
import { isOneOf } from "#/lib/is-one-of.ts";
import { documentTypeLabels, documentTypes, patientInputSchema } from "#/lib/patients.ts";
import type { DocumentType, DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";
import { emptyPhoneEntry, splitPhone } from "#/lib/phones.ts";
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
  chosenName: "El apodo es demasiado largo.",
  documentType: "Elegí el tipo de documento.",
  documentNumber: "El número de documento es demasiado largo.",
  birthDate: "La fecha de nacimiento no es válida.",
  email: "El correo electrónico no es válido.",
  address: "El domicilio es demasiado largo.",
  // A guardian's.
  name: "Ingresá el nombre.",
  relationship: "Ingresá la relación con el paciente.",
  // The phone and the document carry their own refusal as the issue's message.
  ...phoneMessages,
  documentIncomplete: "Elegí el tipo de documento e ingresá su número.",
  invalidDni: "El DNI tiene que ser un número, con o sin puntos.",
  futureBirthDate: "La fecha de nacimiento no puede ser futura.",
  birthDateTooOld: "La fecha de nacimiento no puede ser de hace más de 100 años.",
};

/** The copy for a patient's or guardian's field: the phone and the document carry their own. */
export const patientMessage = (issue: z.core.$ZodIssue) =>
  fieldMessages[issue.message] ?? messageIn(fieldMessages)(issue);

const noPatient = {
  firstName: "",
  lastName: "",
  phone: emptyPhoneEntry,
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
  return { ...(Object.fromEntries(held) as typeof noPatient), phone: splitPhone(initial.phone) };
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

/** An example number for each document type, as its field's placeholder: none until one is picked. */
export function documentNumberPlaceholder(type: string): string | undefined {
  return isOneOf(documentTypes, type) ? documentNumberExamples[type] : undefined;
}

const documentNumberExamples: Record<DocumentType, string> = {
  dni: "30123456",
  passport: "AAA123456",
  other: "A1234567",
};

/** The email field's example. */
export const emailPlaceholder = "nombre@ejemplo.com";

export const documentTypeOptions: SelectOption[] = [
  { value: "", label: "Sin documento" },
  ...documentTypes.map((type) => ({ value: type, label: documentTypeLabels[type] })),
];

/** Where a patient's page holds a field: its `Datos generales` tab or its `Contacto` tab. */
export type PatientFieldTab = "datos" | "contacto";

/** The fields a patient's `Contacto` tab holds; every other one is in `Datos generales`. */
export const contactFields = new Set(["email", "address", "phone"]);

/**
 * The registration inputs: the names and the phone always, the rest when
 * `full`, in rows: the names; the chosen name and the birth date; the
 * document; the email and the address; the phone, on a row of its own. A
 * patient's page shows one `tab` of them at a time (`contactFields`); the
 * form holds every value either way. They are rows of a `FormGrid`.
 */
export function PatientFields(props: {
  form: PatientForm;
  full: boolean;
  tab?: PatientFieldTab;
  /** After the phone's number: the patient's `Ver conversación`. */
  phoneAction?: ReactNode;
}) {
  const { form, tab } = props;
  if (!props.full) {
    return (
      <>
        <NameFields form={form} size={undefined} />
        <PhoneRow form={form} full={false} />
      </>
    );
  }
  return (
    <>
      {tab !== "contacto" && <GeneralFields form={form} />}
      {tab !== "datos" && <ContactFields form={form} phoneAction={props.phoneAction} />}
    </>
  );
}

type PatientForm = ReturnType<typeof usePatientForm>;

function NameFields(props: { form: PatientForm; size: "half" | undefined }) {
  const { form, size } = props;
  return (
    <>
      <form.AppField name="firstName">
        {(field) => <field.TextField label="Nombre" size={size} required />}
      </form.AppField>
      <form.AppField name="lastName">
        {(field) => <field.TextField label="Apellido" size={size} required />}
      </form.AppField>
    </>
  );
}

/** `Datos generales`: the names; the chosen name and the birth date; the document. */
function GeneralFields({ form }: { form: PatientForm }) {
  const documentType = useStore(form.store, (state) => state.values.documentType);
  return (
    <>
      <NameFields form={form} size="half" />
      <form.AppField name="chosenName">
        {(field) => <field.TextField label="Apodo" size="half" startsRow />}
      </form.AppField>
      <form.AppField name="birthDate">
        {(field) => <field.DateField label="Fecha de nacimiento" size="half" />}
      </form.AppField>
      <form.AppField name="documentType">
        {(field) => (
          <field.SelectField
            label="Tipo de documento"
            size="half"
            startsRow
            options={documentTypeOptions}
          />
        )}
      </form.AppField>
      <form.AppField name="documentNumber">
        {(field) => (
          <field.TextField
            label="Número de documento"
            size="half"
            placeholder={documentNumberPlaceholder(documentType)}
          />
        )}
      </form.AppField>
    </>
  );
}

/** `Contacto`: the email and the address; the phone on a row of its own. */
function ContactFields(props: { form: PatientForm; phoneAction?: ReactNode }) {
  const { form } = props;
  return (
    <>
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="Correo electrónico"
            type="email"
            size="half"
            startsRow
            placeholder={emailPlaceholder}
          />
        )}
      </form.AppField>
      <form.AppField name="address">
        {(field) => (
          <field.TextField label="Domicilio" size="half" placeholder="Av. Colón 1234, Córdoba" />
        )}
      </form.AppField>
      <PhoneRow form={form} full action={props.phoneAction} />
    </>
  );
}

function PhoneRow(props: { form: PatientForm; full: boolean; action?: ReactNode }) {
  const { form, full } = props;
  return (
    <form.AppField name="phone">
      {(field) => (
        <field.PhoneField
          label="Teléfono"
          required
          size={full ? "half" : undefined}
          startsRow={full}
          action={props.action}
        />
      )}
    </form.AppField>
  );
}

/** Whether the form has no birth date, which leaves the patient incomplete. */
export function useBirthDateMissing(form: ReturnType<typeof usePatientForm>) {
  return useStore(form.store, (state) => state.values.birthDate === "");
}

/** Above a patient's form while it has no birth date: what that means for the record. */
export function IncompleteAlert() {
  return (
    <Alert variant="warning">
      <AlertTitle>Paciente incompleto</AlertTitle>
      <AlertDescription>
        Falta la fecha de nacimiento para completar la información básica del paciente.
      </AlertDescription>
    </Alert>
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

  useFocusProblem(element, alert, [problems, save.holder, save.error]);

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
  const birthDateMissing = useBirthDateMissing(form);
  return (
    <FormPage
      page={page}
      form={form}
      alerts={birthDateMissing && <IncompleteAlert />}
      title="Nuevo paciente"
      description="Alguien que se atiende en la organización: con nombre y teléfono alcanza para darle un turno."
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
