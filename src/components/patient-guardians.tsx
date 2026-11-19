import { UsersIcon } from "lucide-react";
import { useStore } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type * as z from "zod";

import { OptionSelect } from "#/components/option-select.tsx";
import { ActionsMenu, ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { fieldProblems } from "#/components/form-problems.ts";
import { ActionFormPage, CreateButton, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import {
  documentNumberPlaceholder,
  documentTypeOptions,
  emailPlaceholder,
  patientMessage,
} from "#/components/patient-form.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import type { GuardianInput } from "#/lib/guardians.ts";
import { documentLabel } from "#/lib/patients.ts";
import type { DocumentType } from "#/lib/patients.ts";
import { formatPhone, splitPhone } from "#/lib/phones.ts";
import { changeMessageContact, deleteGuardian } from "#/server/guardians.functions.ts";
import type { Guardian } from "#/organization/guardians.ts";
import type { Patient } from "#/organization/patients.ts";

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

/** A guardian in the patient's list, with the patient its page hangs off. */
type ListedGuardian = Guardian & { patientId: string };

const guardianColumns: DataTableColumn<ListedGuardian>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (guardian) => (
      <RowName
        name={guardian.name}
        link={{
          to: "/pacientes/$patientId/responsables/$guardianId",
          params: { patientId: guardian.patientId, guardianId: guardian.id },
        }}
        status={guardian.messageContact && <Badge variant="outline">Recibe los mensajes</Badge>}
      />
    ),
  },
  { id: "relationship", header: "Relación", cell: (guardian) => guardian.relationship },
  { id: "phone", header: "Teléfono", cell: (guardian) => formatPhone(guardian.phone) },
  { id: "document", header: "Documento", cell: (guardian) => documentLabel(guardian) },
  { id: "email", header: "Correo electrónico", cell: (guardian) => guardian.email },
];

/** The patient's guardians, in the patient page's `Responsables` tab: a row's name opens its page. */
export function GuardianList(props: { patientId: string; guardians: Guardian[] }) {
  const { table } = useClientDataTable({
    rows: props.guardians.map((guardian) => ({ ...guardian, patientId: props.patientId })),
    columns: guardianColumns,
    getRowId: (guardian) => guardian.id,
  });
  return (
    <DataTable
      table={table}
      noRecords={props.guardians.length === 0}
      empty={
        <EmptyState
          icon={UsersIcon}
          title="Sin responsables"
          description="Los mensajes van al paciente."
        >
          <CreateButton
            link={
              <Link
                to="/pacientes/$patientId/responsables/nuevo"
                params={{ patientId: props.patientId }}
              />
            }
          >
            Agregar responsable
          </CreateButton>
        </EmptyState>
      }
    />
  );
}

/** A guardian's page's `Acciones`: `Quitar`, which asks first and goes back to the patient's guardians. */
export function useGuardianRecord(patientId: string, guardian: Guardian): RecordHeader {
  const action = useAction();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return {
    actions: (busy) => (
      <>
        <ActionsMenu disabled={action.pending || busy}>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            Quitar
          </DropdownMenuItem>
        </ActionsMenu>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="¿Quitar este responsable?"
          description={
            guardian.messageContact
              ? "Deja de estar a cargo del paciente, y los mensajes vuelven a ir al paciente."
              : "Deja de estar a cargo del paciente."
          }
          confirmLabel="Quitar"
          onConfirm={() =>
            void action
              .save(() => deleteGuardian({ data: { guardianId: guardian.id } }))
              .then(
                (removed) =>
                  removed &&
                  void navigate({
                    to: "/pacientes/$patientId",
                    params: { patientId },
                    search: { seccion: "responsables" },
                  }),
              )
          }
        />
      </>
    ),
    error: action.error,
  };
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
      <OptionSelect
        id={id}
        value={current?.id ?? ""}
        disabled={action.pending}
        onValueChange={(value) => {
          const guardianId = value || null;
          void action.run(() =>
            changeMessageContact({ data: { patientId: props.patient.id, guardianId } }),
          );
        }}
        options={[
          { value: "", label: `El paciente (${formatPhone(props.patient.phone)})` },
          ...props.guardians.map((guardian) => ({
            value: guardian.id,
            label: `${guardian.name} (${formatPhone(guardian.phone)})`,
          })),
        ]}
      />
      <ErrorAlert message={action.error} />
    </Field>
  );
}

interface GuardianFormProps {
  patientId: string;
  title: string;
  description: string;
  /** The guardian's fields, the phone as stored (E.164), or empty for a new guardian. */
  initial: Omit<GuardianFields, "phone"> & { phone: string };
  submitLabel: string;
  creates?: boolean;
  /** The schema the server function checks the input with, which the form checks first. */
  schema: z.ZodType;
  /** The ids the input carries beside the fields, for `schema`. */
  ids: Record<string, string>;
  /** An existing guardian's `Acciones` (`useGuardianRecord`). */
  record?: RecordHeader;
  onSubmit: (fields: GuardianFields) => Promise<ActionResult>;
}

const guardianValues = (initial: GuardianFormProps["initial"]) => ({
  name: initial.name,
  relationship: initial.relationship,
  phone: splitPhone(initial.phone),
  documentType: (initial.documentType ?? "") as string,
  documentNumber: initial.documentNumber ?? "",
  email: initial.email ?? "",
});

export function GuardianForm(props: GuardianFormProps) {
  const { patientId } = props;
  const page = useFormPage({
    to: "/pacientes/$patientId",
    params: { patientId },
    search: { seccion: "responsables" },
  });
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

  const documentType = useStore(form.store, (state) => state.values.documentType);

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      creates={props.creates}
      record={props.record}
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="relationship">
        {(field) => (
          <field.TextField label="Relación" required hint="Por ejemplo: madre, padre, tutora." />
        )}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => <field.PhoneField label="Teléfono" required />}
      </form.AppField>
      <form.AppField name="documentType">
        {(field) => (
          <field.SelectField label="Tipo de documento" startsRow options={documentTypeOptions} />
        )}
      </form.AppField>
      <form.AppField name="documentNumber">
        {(field) => (
          <field.TextField
            label="Número de documento"
            placeholder={documentNumberPlaceholder(documentType)}
          />
        )}
      </form.AppField>
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
    </ActionFormPage>
  );
}
