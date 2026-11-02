import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { fieldMessage } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { practitionerColorLabels, practitionerColors } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { practitionerUpdateSchema } from "#/lib/staff.ts";
import type { PractitionerUpdate } from "#/lib/staff.ts";
import { editPractitioner, getMember } from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/server/staff.ts";

import { ColorSwatch, RefusalAlert, useAction } from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId_/profesional")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: () => ({ meta: [{ title: "Editar profesional · Rubens" }] }),
  component: EditPractitioner,
});

const practitionerFieldMessages: Record<keyof PractitionerUpdate, string> = {
  memberId: "No encontramos a esa persona.",
  displayName: "Ingresá el nombre a mostrar.",
  specialty: "La especialidad es demasiado larga.",
  keepsClinicalRecords: "Revisá los datos ingresados.",
  gridMinutes: "El intervalo tiene que ser un número de minutos entre 5 y 120.",
  color: "Elegí un color.",
};

function EditPractitioner() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const { member } = result;
  if (!member.practitioner) {
    return <RefusalAlert reason="notFound" />;
  }
  return <PractitionerForm member={member} settings={member.practitioner} />;
}

function PractitionerForm(props: { member: StaffMember; settings: PractitionerSettings }) {
  const { settings } = props;
  const { memberId } = props.member;
  const page = useFormPage({ to: "/personal/$memberId", params: { memberId } });
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const update = {
      memberId,
      displayName: form.get("displayName") as string,
      specialty: form.get("specialty") as string,
      keepsClinicalRecords: form.get("keepsClinicalRecords") === "on",
      gridMinutes: Number(form.get("gridMinutes")),
      color: form.get("color") as PractitionerColor,
    };
    const parsed = practitionerUpdateSchema.safeParse(update);
    if (!parsed.success) {
      action.setError(fieldMessage(practitionerFieldMessages, parsed.error));
      return;
    }
    if (await action.run(() => editPractitioner({ data: update }))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Editar profesional"
      description={props.member.name}
      submitLabel="Guardar"
      action={action}
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor="displayName">Nombre a mostrar</FieldLabel>
        <Input id="displayName" name="displayName" defaultValue={settings.displayName} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="specialty">Especialidad</FieldLabel>
        <Input id="specialty" name="specialty" defaultValue={settings.specialty ?? ""} />
      </Field>
      <Field>
        <FieldLabel htmlFor="gridMinutes">Intervalo de turnos (minutos)</FieldLabel>
        <Input
          id="gridMinutes"
          name="gridMinutes"
          type="number"
          min={5}
          max={120}
          defaultValue={settings.gridMinutes}
          required
          className="w-32 max-w-32"
          aria-describedby="gridMinutes-hint"
        />
        <FieldDescription id="gridMinutes-hint">
          Los horarios libres empiezan cada tantos minutos, contados desde la medianoche.
        </FieldDescription>
      </Field>
      <ColorField initial={settings.color} />
      <Field orientation="horizontal" className="w-fit">
        {/* Keyed on the saved value: Base UI warns when an uncontrolled
            checkbox's default changes, as it does after a save reloads. */}
        <Checkbox
          key={String(settings.keepsClinicalRecords)}
          id="keepsClinicalRecords"
          name="keepsClinicalRecords"
          defaultChecked={settings.keepsClinicalRecords}
        />
        <FieldLabel htmlFor="keepsClinicalRecords">Lleva historia clínica</FieldLabel>
      </Field>
    </ActionFormPage>
  );
}

/** The colour of the practitioner's appointments on the calendar, with its swatch. */
function ColorField(props: { initial: PractitionerColor }) {
  const [color, setColor] = useState(props.initial);
  return (
    <Field>
      <FieldLabel htmlFor="color">Color en la agenda</FieldLabel>
      <div className="flex items-center gap-3">
        <NativeSelect
          id="color"
          name="color"
          value={color}
          onChange={(event) => setColor(event.target.value as PractitionerColor)}
        >
          {practitionerColors.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {practitionerColorLabels[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ColorSwatch color={color} />
      </div>
    </Field>
  );
}
