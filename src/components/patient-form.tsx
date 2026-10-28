import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions } from "#/components/admin-form.tsx";
import { DocumentTakenAlert, DuplicateWarning } from "#/components/patient-duplicates.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { documentTypeLabels, documentTypes, patientInputSchema } from "#/lib/patients.ts";
import type { DocumentType, DuplicateConfirmation, PatientInput } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { addPatient } from "#/server/patients.functions.ts";
import type { DuplicateCandidate, DuplicateRefusal, Patient } from "#/server/patients.ts";

// The patient's registration fields, shared by quick registration (embedded
// by the patient list, and later by booking) and the patient page's edit.

/** The copy for every refusal the patient server functions return. */
export const patientRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede desactivar pacientes y ver su historial de cambios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese paciente.",
};

type PatientRefusal = keyof typeof patientRefusalMessages;

/** What registering or editing a patient answers. */
type SaveResult =
  | { ok: true; patient: Patient }
  | { ok: false; reason: PatientRefusal }
  | DuplicateRefusal;

/** What the form shows after a save was refused: one of the three at most. */
interface RefusalState {
  error: string | null;
  holder: Patient | null;
  candidates: DuplicateCandidate[];
}

const noRefusal: RefusalState = { error: null, holder: null, candidates: [] };

function refusalState(result: Exclude<SaveResult, { ok: true }>): RefusalState {
  if (result.reason === "documentTaken") {
    return { ...noRefusal, holder: result.patient };
  }
  if (result.reason === "possibleDuplicates") {
    return { ...noRefusal, candidates: result.candidates };
  }
  return { ...noRefusal, error: patientRefusalMessages[result.reason] };
}

/**
 * The submit step of the registration and edit forms. `send` saves the input;
 * a likely duplicate holds it back until `confirm` sends it again, confirmed.
 * Reloads the route's data and calls `onSaved` once it is saved.
 */
export function usePatientSave<I extends object>(
  send: (input: I & DuplicateConfirmation) => Promise<SaveResult>,
  onSaved: (patient: Patient) => void,
) {
  const router = useRouter();
  const [refusal, setRefusal] = useState(noRefusal);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState<I | null>(null);

  async function save(next: I, confirmDuplicates: boolean) {
    setInput(next);
    setPending(true);
    setRefusal(noRefusal);
    const result = await send({ ...next, confirmDuplicates });
    setPending(false);
    if (!result.ok) {
      setRefusal(refusalState(result));
      return;
    }
    await router.invalidate();
    onSaved(result.patient);
  }

  return {
    ...refusal,
    pending,
    setError: (error: string) => setRefusal({ ...noRefusal, error }),
    submit: (next: I) => save(next, false),
    confirm: () => input && save(input, true),
    dismiss: () => setRefusal(noRefusal),
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

function Field(props: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
      />
      {props.hint && <p className="text-muted-foreground text-sm">{props.hint}</p>}
    </div>
  );
}

/** What the inputs start with: nothing for a registration, the patient's data for an edit. */
function formValues(initial: Patient | undefined): Partial<Patient> {
  return initial ? { ...initial, phone: formatPhone(initial.phone) } : {};
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
      <Field
        id={id("phone")}
        name="phone"
        label="Teléfono"
        type="tel"
        defaultValue={values.phone}
        required
        hint="Con código de área, como se dice: 0351 15 555-1234. Del exterior, con + y el código del país."
      />
      {props.full && (
        <>
          <Field
            id={id("chosenName")}
            name="chosenName"
            label="Nombre autopercibido"
            defaultValue={values.chosenName}
            hint="Si la persona usa otro nombre, la app la llama así."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={id("documentType")}>Tipo de documento</Label>
              <NativeSelect
                id={id("documentType")}
                name="documentType"
                defaultValue={values.documentType ?? ""}
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
              defaultValue={values.documentNumber}
            />
          </div>
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
