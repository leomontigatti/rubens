import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import type * as z from "zod";

import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { practitionerColorLabels, practitionerColors } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { memberUpdateSchema } from "#/lib/staff.ts";
import { editMember, getMember } from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/server/staff.ts";

import {
  ColorSwatch,
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  useAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId_/editar")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: () => ({ meta: [{ title: "Editar persona · Rubens" }] }),
  component: EditMember,
});

const fieldMessages: Record<string, string> = {
  roles: "Elegí al menos un rol.",
  displayName: "Ingresá el nombre a mostrar.",
  specialty: "La especialidad es demasiado larga.",
  gridMinutes: "El intervalo tiene que ser un número de minutos entre 5 y 120.",
  color: "Elegí un color.",
};

/** The copy for the first field the schema refused, nested or not. */
function memberFieldMessage(error: z.ZodError): string {
  const field = error.issues[0]!.path.find((part) => String(part) in fieldMessages);
  return fieldMessages[String(field)] ?? "Revisá los datos ingresados.";
}

function readSettings(form: FormData) {
  return {
    displayName: form.get("displayName") as string,
    specialty: form.get("specialty") as string,
    keepsClinicalRecords: form.get("keepsClinicalRecords") === "on",
    gridMinutes: Number(form.get("gridMinutes")),
    color: form.get("color") as PractitionerColor,
  };
}

const sameRoles = (roles: string[], saved: readonly string[]) =>
  roles.length === saved.length && roles.every((role) => saved.includes(role));

/** Whether what the form holds is what it opened with: an empty specialty is none. */
function sameSettings(form: ReturnType<typeof readSettings>, saved: PractitionerSettings) {
  const opened = { ...saved, specialty: saved.specialty ?? "" };
  return Object.entries(opened).every(([key, value]) => form[key as keyof typeof opened] === value);
}

function changedSettings(form: FormData, saved: PractitionerSettings | null) {
  if (!saved) {
    return undefined;
  }
  const settings = readSettings(form);
  return sameSettings(settings, saved) ? undefined : settings;
}

/** Only the parts the form changed: a stale page leaves the other part as it is. */
function changesIn(form: FormData, member: StaffMember) {
  const roles = formRoles(form);
  return {
    roles: sameRoles(roles, member.roles) ? undefined : roles,
    practitioner: changedSettings(form, shownSettings(member)),
  };
}

function EditMember() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  return <MemberForm member={result.member} />;
}

/** The settings the form shows: those of someone who is a practitioner now. */
function shownSettings(member: StaffMember) {
  return member.roles.includes("practitioner") ? member.practitioner : null;
}

function MemberForm({ member }: { member: StaffMember }) {
  const { memberId } = member;
  const page = useFormPage({ to: "/personal/$memberId", params: { memberId } });
  const action = useAction();
  const settings = shownSettings(member);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const update = { memberId, ...changesIn(form, member) };
    const parsed = memberUpdateSchema.safeParse(update);
    if (!parsed.success) {
      action.setError(memberFieldMessage(parsed.error));
      return;
    }
    if (await action.save(() => editMember({ data: { ...update, roles: parsed.data.roles } }))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Editar persona"
      description={member.name}
      submitLabel="Guardar"
      action={action}
      onSubmit={handleSubmit}
    >
      <RoleCheckboxes idPrefix={memberId} initial={member.roles} />
      {settings && <PractitionerFields settings={settings} />}
    </ActionFormPage>
  );
}

function PractitionerFields({ settings }: { settings: PractitionerSettings }) {
  return (
    <>
      <h2 className="text-lg font-semibold">Profesional</h2>
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
    </>
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
