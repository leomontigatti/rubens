import { Link } from "@tanstack/react-router";
import type * as z from "zod";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import {
  documentTypeOptions,
  patientMessage,
  phoneFieldProps,
} from "#/components/patient-form.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import type { GuardianInput } from "#/lib/guardians.ts";
import { documentLabel } from "#/lib/patients.ts";
import type { DocumentType } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { changeMessageContact, deleteGuardian } from "#/server/guardians.functions.ts";
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

export function GuardianList(props: { patientId: string; guardians: Guardian[] }) {
  if (props.guardians.length === 0) {
    return <p className="text-muted-foreground">Sin responsables.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {props.guardians.map((guardian) => (
        <li key={guardian.id} className="flex flex-wrap items-start justify-between gap-4">
          <GuardianSummary guardian={guardian} />
          <GuardianControls patientId={props.patientId} guardian={guardian} />
        </li>
      ))}
    </ul>
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

function GuardianControls({ patientId, guardian }: { patientId: string; guardian: Guardian }) {
  const action = useAction();
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/pacientes/$patientId/responsables/$guardianId"
              params={{ patientId, guardianId: guardian.id }}
            />
          }
        >
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
    <Field>
      <FieldLabel htmlFor={id}>Los mensajes van a</FieldLabel>
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
    </Field>
  );
}

interface GuardianFormProps {
  patientId: string;
  title: string;
  description: string;
  initial: GuardianFields;
  submitLabel: string;
  /** The schema the server function checks the input with, which the form checks first. */
  schema: z.ZodType;
  /** The ids the input carries beside the fields, for `schema`. */
  ids: Record<string, string>;
  onSubmit: (fields: GuardianFields) => Promise<ActionResult>;
}

const guardianValues = (initial: GuardianFields) => ({
  name: initial.name,
  relationship: initial.relationship,
  phone: initial.phone,
  documentType: (initial.documentType ?? "") as string,
  documentNumber: initial.documentNumber ?? "",
  email: initial.email ?? "",
});

export function GuardianForm(props: GuardianFormProps) {
  const { patientId } = props;
  const page = useFormPage({ to: "/pacientes/$patientId", params: { patientId } });
  const action = useAction();
  const form = useAppForm({
    defaultValues: guardianValues(props.initial),
    onSubmit: async ({ value }) => {
      const fields = {
        ...value,
        documentType: (value.documentType || null) as DocumentType | null,
      };
      const checked = props.schema.safeParse({ ...fields, ...props.ids });
      if (!checked.success) {
        page.showProblems(fieldProblems(checked.error.issues, patientMessage));
        return;
      }
      if (await action.save(() => props.onSubmit(fields))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="name">
          {(field) => <field.TextField label="Nombre" required />}
        </form.AppField>
        <form.AppField name="relationship">
          {(field) => (
            <field.TextField label="Relación" required hint="Por ejemplo: madre, padre, tutora." />
          )}
        </form.AppField>
      </div>
      <form.AppField name="phone">
        {(field) => <field.TextField {...phoneFieldProps} />}
      </form.AppField>
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="documentType">
          {(field) => (
            <field.SelectField label="Tipo de documento">{documentTypeOptions}</field.SelectField>
          )}
        </form.AppField>
        <form.AppField name="documentNumber">
          {(field) => <field.TextField label="Número de documento" />}
        </form.AppField>
      </div>
      <form.AppField name="email">
        {(field) => <field.TextField label="Correo electrónico" type="email" />}
      </form.AppField>
    </ActionFormPage>
  );
}
