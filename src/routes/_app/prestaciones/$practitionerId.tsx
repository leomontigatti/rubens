import { StethoscopeIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  AdminControls,
  ErrorAlert,
  FormActions,
  RefusalMessage,
  fieldMessage,
  useFormAction,
  NameField,
} from "#/components/admin-form.tsx";
import { CreateSheet, FormSheet } from "#/components/form-sheet.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { medicalServiceInputSchema } from "#/lib/medical-services.ts";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";
import {
  addMedicalService,
  changeMedicalServiceActive,
  editMedicalService,
  getMedicalServices,
} from "#/server/medical-services.functions.ts";
import type { MedicalService } from "#/server/medical-services.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";
import type { RefusalReason } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/$practitionerId")({
  loader: ({ params }) =>
    getMedicalServices({
      data: { practitionerId: params.practitionerId, includeInactive: true },
    }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `Prestaciones de ${loaderData.practitioner.displayName} · Rubens`
          : "Prestaciones · Rubens",
      },
    ],
  }),
  component: PractitionerMedicalServices,
});

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<keyof MedicalServiceFields | "practitionerId", string> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "La duración tiene que ser de 1 a 720 minutos.",
};

const newMedicalService: MedicalServiceFields = {
  name: "",
  durationMinutes: 30,
};

function useAction() {
  return useFormAction(refusalMessages);
}

function PractitionerMedicalServices() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const { practitioner, medicalServices, canEdit } = result;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ to: "/prestaciones", label: "Prestaciones" }}
        title={practitioner.displayName}
      />
      <CreateSheet canCreate={canEdit} label="Nueva prestación">
        {(close) => (
          <MedicalServiceForm
            idPrefix="new"
            initial={newMedicalService}
            submitLabel="Crear"
            onCancel={close}
            onSubmit={(fields) =>
              addMedicalService({ data: { ...fields, practitionerId: practitioner.id } })
            }
            onDone={close}
          />
        )}
      </CreateSheet>
      {medicalServices.length === 0 ? (
        <EmptyState
          icon={StethoscopeIcon}
          title="Todavía no tiene prestaciones"
          description="Agregá la primera con Nueva prestación."
          canAct={canEdit}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {medicalServices.map((medicalService) => (
            <MedicalServiceItem
              key={medicalService.id}
              medicalService={medicalService}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MedicalServiceItem(props: { medicalService: MedicalService; canEdit: boolean }) {
  const { medicalService } = props;
  const [editing, setEditing] = useState(false);
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                {medicalService.name}
                {!medicalService.active && <Badge variant="secondary">Inactiva</Badge>}
              </span>
              <span className="text-muted-foreground text-sm">
                {medicalService.durationMinutes} min
              </span>
            </div>
          </div>
          <AdminControls
            isAdmin={props.canEdit}
            active={medicalService.active}
            onEdit={() => setEditing(true)}
            onToggleActive={() =>
              void toggle.run(() =>
                changeMedicalServiceActive({
                  data: { id: medicalService.id, active: !medicalService.active },
                }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
      <FormSheet open={editing} onClose={() => setEditing(false)} title="Editar prestación">
        <MedicalServiceForm
          idPrefix={medicalService.id}
          initial={medicalService}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={(fields) =>
            editMedicalService({
              data: { ...fields, medicalServiceId: medicalService.id },
            })
          }
          onDone={() => setEditing(false)}
        />
      </FormSheet>
    </li>
  );
}

interface MedicalServiceFormProps {
  idPrefix: string;
  initial: MedicalServiceFields;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (fields: MedicalServiceFields) => Promise<ActionResult>;
  onDone: () => void;
}

const fieldsSchema = medicalServiceInputSchema.omit({ practitionerId: true });

function MedicalServiceForm({
  idPrefix,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
  onDone,
}: MedicalServiceFormProps) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = fieldsSchema.safeParse({
      name: form.get("name"),
      durationMinutes: Number(form.get("durationMinutes")),
    });
    if (!fields.success) {
      action.setError(fieldMessage(fieldMessages, fields.error));
      return;
    }
    if (await action.run(() => onSubmit(fields.data))) {
      onDone();
    }
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <ErrorAlert message={action.error} />
      <NameField idPrefix={idPrefix} initial={initial.name} />
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-duration`}>Duración (minutos)</FieldLabel>
        <Input
          id={`${idPrefix}-duration`}
          name="durationMinutes"
          type="number"
          min={1}
          max={720}
          step={1}
          defaultValue={initial.durationMinutes}
          required
        />
      </Field>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
