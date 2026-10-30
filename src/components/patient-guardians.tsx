import { useState } from "react";
import type { FormEvent } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions, useFormAction } from "#/components/admin-form.tsx";
import {
  DocumentInputs,
  Field,
  PhoneField,
  patientFieldMessage,
} from "#/components/patient-form.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { guardianInputSchema, guardianUpdateSchema } from "#/lib/guardians.ts";
import type { GuardianInput } from "#/lib/guardians.ts";
import { documentLabel } from "#/lib/patients.ts";
import type { DocumentType } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import {
  addPatientGuardian,
  changeMessageContact,
  deleteGuardian,
  editGuardian,
} from "#/server/guardians.functions.ts";
import type { Guardian } from "#/server/guardians.ts";
import type { Patient } from "#/server/patients.ts";

// The guardians section of the patient page: the list, the add and edit form,
// who messages go to, and the prompt to add a guardian for a minor, which
// never blocks a save.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No tenés permiso para cambiar los responsables de este paciente.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese responsable.",
};

type ActionResult = { ok: true } | { ok: false; reason: keyof typeof refusalMessages };

type GuardianFields = Omit<GuardianInput, "patientId">;

function useAction() {
  return useFormAction(refusalMessages);
}

/** The prompt a minor with no guardian shows. */
export function MinorPrompt(props: { patient: Patient; guardians: Guardian[] }) {
  if (!props.patient.minor || props.guardians.length > 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Falta un responsable</AlertTitle>
      <AlertDescription>Es menor de edad: agregá un responsable.</AlertDescription>
    </Alert>
  );
}

export function GuardianList({ guardians }: { guardians: Guardian[] }) {
  if (guardians.length === 0) {
    return <p className="text-muted-foreground">Sin responsables.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {guardians.map((guardian) => (
        <GuardianItem key={guardian.id} guardian={guardian} />
      ))}
    </ul>
  );
}

function GuardianItem({ guardian }: { guardian: Guardian }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <GuardianForm
          idPrefix={guardian.id}
          initial={{ ...guardian, phone: formatPhone(guardian.phone) }}
          submitLabel="Guardar"
          schema={guardianUpdateSchema}
          ids={{ guardianId: guardian.id }}
          onSubmit={(fields) => editGuardian({ data: { ...fields, guardianId: guardian.id } })}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-4">
      <GuardianSummary guardian={guardian} />
      <GuardianControls guardian={guardian} onEdit={() => setEditing(true)} />
    </li>
  );
}

function GuardianSummary({ guardian }: { guardian: Guardian }) {
  const details = [formatPhone(guardian.phone), documentLabel(guardian), guardian.email];
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{guardian.name}</span>
        <span className="text-muted-foreground">· {guardian.relationship}</span>
        {guardian.messageContact && <Badge variant="outline">Recibe los mensajes</Badge>}
      </p>
      <p className="text-muted-foreground text-sm">{details.filter(Boolean).join(" · ")}</p>
    </div>
  );
}

function GuardianControls({ guardian, onEdit }: { guardian: Guardian; onEdit: () => void }) {
  const action = useAction();
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={action.pending}
          onClick={() =>
            void action.run(() => deleteGuardian({ data: { guardianId: guardian.id } }))
          }
        >
          Quitar
        </Button>
      </div>
      <ErrorAlert message={action.error} />
    </div>
  );
}

/** Who messages go to: the patient, the default, or one of their guardians. */
export function MessageContactChoice(props: { patient: Patient; guardians: Guardian[] }) {
  const action = useAction();
  if (props.guardians.length === 0) {
    return null;
  }
  const current = props.guardians.find((guardian) => guardian.messageContact);
  const id = `${props.patient.id}-messageContact`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Los mensajes van a</Label>
      <NativeSelect
        id={id}
        value={current?.id ?? ""}
        disabled={action.pending}
        onChange={(event) => {
          const guardianId = event.currentTarget.value || null;
          void action.run(() =>
            changeMessageContact({ data: { patientId: props.patient.id, guardianId } }),
          );
        }}
      >
        <NativeSelectOption value="">
          El paciente ({formatPhone(props.patient.phone)})
        </NativeSelectOption>
        {props.guardians.map((guardian) => (
          <NativeSelectOption key={guardian.id} value={guardian.id}>
            {guardian.name} ({formatPhone(guardian.phone)})
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <ErrorAlert message={action.error} />
    </div>
  );
}

/** The form that adds a guardian to the patient. */
export function NewGuardianForm(props: { patientId: string; onDone: () => void }) {
  return (
    <GuardianForm
      idPrefix="new-guardian"
      initial={{ name: "", relationship: "", phone: "" }}
      submitLabel="Agregar"
      schema={guardianInputSchema}
      ids={{ patientId: props.patientId }}
      onSubmit={(fields) => addPatientGuardian({ data: { ...fields, patientId: props.patientId } })}
      onDone={props.onDone}
    />
  );
}

interface GuardianFormProps {
  idPrefix: string;
  initial: GuardianFields;
  submitLabel: string;
  /** The schema the server function checks the input with, which the form checks first. */
  schema: z.ZodType;
  /** The ids the input carries beside the fields, for `schema`. */
  ids: Record<string, string>;
  onSubmit: (fields: GuardianFields) => Promise<ActionResult>;
  onDone: () => void;
}

/** The fields the form submitted, as typed: the schema, on both sides, checks them. */
function readGuardianForm(form: FormData): GuardianFields {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    relationship: text("relationship"),
    documentType: (text("documentType") || null) as DocumentType | null,
    documentNumber: text("documentNumber"),
    phone: text("phone"),
    email: text("email"),
  };
}

function GuardianForm(props: GuardianFormProps) {
  const action = useAction();
  const id = (name: string) => `${props.idPrefix}-${name}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readGuardianForm(new FormData(event.currentTarget));
    const checked = props.schema.safeParse({ ...fields, ...props.ids });
    if (!checked.success) {
      action.setError(patientFieldMessage(checked.error));
      return;
    }
    if (await action.run(() => props.onSubmit(fields))) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={id("name")}
          name="name"
          label="Nombre"
          defaultValue={props.initial.name}
          required
        />
        <Field
          id={id("relationship")}
          name="relationship"
          label="Relación"
          defaultValue={props.initial.relationship}
          required
          hint="Por ejemplo: madre, padre, tutora."
        />
      </div>
      <PhoneField id={id("phone")} defaultValue={props.initial.phone} />
      <DocumentInputs idPrefix={props.idPrefix} initial={props.initial} />
      <Field
        id={id("email")}
        name="email"
        label="Correo electrónico"
        type="email"
        defaultValue={props.initial.email}
      />
      <FormActions
        pending={action.pending}
        submitLabel={props.submitLabel}
        onCancel={props.onDone}
      />
    </form>
  );
}
