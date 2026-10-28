import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  AdminControls,
  CreatePanel,
  ErrorAlert,
  FormActions,
  RefusalMessage,
  fieldMessage,
  useFormAction,
} from "#/components/admin-form.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  appointmentTypeColorClasses,
  appointmentTypeColorLabels,
  appointmentTypeColors,
  appointmentTypeInputSchema,
} from "#/lib/appointment-types.ts";
import type { AppointmentTypeColor, AppointmentTypeFields } from "#/lib/appointment-types.ts";
import {
  addAppointmentType,
  changeAppointmentTypeActive,
  editAppointmentType,
  getAppointmentTypes,
} from "#/server/appointment-types.functions.ts";
import type { AppointmentType } from "#/server/appointment-types.ts";

import { refusalMessages } from "#/routes/_app/tipos-de-turno/-shared.ts";
import type { RefusalReason } from "#/routes/_app/tipos-de-turno/-shared.ts";

export const Route = createFileRoute("/_app/tipos-de-turno/$practitionerId")({
  loader: ({ params }) =>
    getAppointmentTypes({
      data: { practitionerId: params.practitionerId, includeInactive: true },
    }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `Tipos de turno de ${loaderData.practitioner.displayName} · Rubens`
          : "Tipos de turno · Rubens",
      },
    ],
  }),
  component: PractitionerAppointmentTypes,
});

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<keyof AppointmentTypeFields | "practitionerId", string> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "La duración tiene que ser de 1 a 720 minutos.",
  color: "Elegí un color.",
};

const newAppointmentType: AppointmentTypeFields = {
  name: "",
  durationMinutes: 30,
  color: "color1",
};

function useAction() {
  return useFormAction(refusalMessages);
}

function PractitionerAppointmentTypes() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const { practitioner, appointmentTypes, canEdit } = result;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/tipos-de-turno"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          Tipos de turno
        </Link>
        <h1 className="text-2xl font-semibold">{practitioner.displayName}</h1>
      </div>
      <CreatePanel isAdmin={canEdit} label="Nuevo tipo de turno">
        {(close) => (
          <AppointmentTypeForm
            idPrefix="new"
            initial={newAppointmentType}
            submitLabel="Crear"
            onCancel={close}
            onSubmit={(fields) =>
              addAppointmentType({ data: { ...fields, practitionerId: practitioner.id } })
            }
            onDone={close}
          />
        )}
      </CreatePanel>
      {appointmentTypes.length === 0 ? (
        <p className="text-muted-foreground">Todavía no tiene tipos de turno.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appointmentTypes.map((appointmentType) => (
            <AppointmentTypeItem
              key={appointmentType.id}
              appointmentType={appointmentType}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ColorSwatch({ color }: { color: AppointmentTypeColor }) {
  return (
    <span
      aria-hidden
      className={`size-4 shrink-0 rounded-full ${appointmentTypeColorClasses[color]}`}
    />
  );
}

function AppointmentTypeItem(props: { appointmentType: AppointmentType; canEdit: boolean }) {
  const { appointmentType } = props;
  const [editing, setEditing] = useState(false);
  const toggle = useAction();

  if (editing) {
    return (
      <li>
        <Card>
          <CardContent>
            <AppointmentTypeForm
              idPrefix={appointmentType.id}
              initial={appointmentType}
              submitLabel="Guardar"
              onCancel={() => setEditing(false)}
              onSubmit={(fields) =>
                editAppointmentType({
                  data: { ...fields, appointmentTypeId: appointmentType.id },
                })
              }
              onDone={() => setEditing(false)}
            />
          </CardContent>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ColorSwatch color={appointmentType.color} />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                {appointmentType.name}
                {!appointmentType.active && <Badge variant="outline">Inactivo</Badge>}
              </span>
              <span className="text-muted-foreground text-sm">
                {appointmentType.durationMinutes} min
              </span>
            </div>
          </div>
          <AdminControls
            isAdmin={props.canEdit}
            active={appointmentType.active}
            onEdit={() => setEditing(true)}
            onToggleActive={() =>
              void toggle.run(() =>
                changeAppointmentTypeActive({
                  data: { id: appointmentType.id, active: !appointmentType.active },
                }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}

interface AppointmentTypeFormProps {
  idPrefix: string;
  initial: AppointmentTypeFields;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (fields: AppointmentTypeFields) => Promise<ActionResult>;
  onDone: () => void;
}

const fieldsSchema = appointmentTypeInputSchema.omit({ practitionerId: true });

function AppointmentTypeForm({
  idPrefix,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
  onDone,
}: AppointmentTypeFormProps) {
  const action = useAction();
  const [color, setColor] = useState(initial.color);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = fieldsSchema.safeParse({
      name: form.get("name"),
      durationMinutes: Number(form.get("durationMinutes")),
      color: form.get("color"),
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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <ErrorAlert message={action.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Nombre</Label>
        <Input id={`${idPrefix}-name`} name="name" defaultValue={initial.name} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-duration`}>Duración (minutos)</Label>
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
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-color`}>Color</Label>
        <div className="flex items-center gap-3">
          <NativeSelect
            id={`${idPrefix}-color`}
            name="color"
            value={color}
            onChange={(event) => setColor(event.target.value as AppointmentTypeColor)}
          >
            {appointmentTypeColors.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {appointmentTypeColorLabels[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <ColorSwatch color={color} />
        </div>
      </div>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
