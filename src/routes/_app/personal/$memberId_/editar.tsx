import { createFileRoute } from "@tanstack/react-router";
import { pickedIn, useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { practitionerColorLabels, practitionerColors } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { memberUpdateSchema } from "#/lib/staff.ts";
import { editMember, getMember } from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/server/staff.ts";

import {
  ColorSwatch,
  RefusalAlert,
  roleOptions,
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

type SettingsValues = Omit<PractitionerSettings, "specialty" | "gridMinutes" | "color"> & {
  specialty: string;
  gridMinutes: string;
  color: string;
};

const noSettings: SettingsValues = {
  displayName: "",
  specialty: "",
  gridMinutes: "",
  color: practitionerColors[0],
  keepsClinicalRecords: false,
};

/** What the form holds of the settings: the interval as typed, no specialty as empty. */
function settingsValues(saved: PractitionerSettings | null): SettingsValues {
  if (!saved) {
    return noSettings;
  }
  return { ...saved, specialty: saved.specialty ?? "", gridMinutes: String(saved.gridMinutes) };
}

type MemberValues = SettingsValues & { roles: string[] };

const sameRoles = (roles: string[], saved: readonly string[]) =>
  roles.length === saved.length && roles.every((role) => saved.includes(role));

function changedSettings(values: MemberValues, saved: PractitionerSettings | null) {
  if (!saved) {
    return undefined;
  }
  const opened = settingsValues(saved);
  const same = (Object.keys(opened) as (keyof SettingsValues)[]).every(
    (key) => values[key] === opened[key],
  );
  if (same) {
    return undefined;
  }
  return {
    displayName: values.displayName,
    specialty: values.specialty,
    keepsClinicalRecords: values.keepsClinicalRecords,
    gridMinutes: Number(values.gridMinutes),
    color: values.color as PractitionerColor,
  };
}

/** Only the parts the form changed: a stale page leaves the other part as it is. */
function changesIn(values: MemberValues, member: StaffMember) {
  return {
    roles: sameRoles(values.roles, member.roles) ? undefined : values.roles,
    practitioner: changedSettings(values, shownSettings(member)),
  };
}

/** The settings the form shows: those of someone who is a practitioner now. */
function shownSettings(member: StaffMember) {
  return member.roles.includes("practitioner") ? member.practitioner : null;
}

function EditMember() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  return <MemberForm member={result.member} />;
}

function MemberForm({ member }: { member: StaffMember }) {
  const { memberId } = member;
  const page = useFormPage({ to: "/personal/$memberId", params: { memberId } });
  const action = useAction();
  const settings = shownSettings(member);
  const defaultValues: MemberValues = {
    ...settingsValues(settings),
    roles: pickedIn(roleOptions, member.roles),
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const update = { memberId, ...changesIn(value, member) };
      const parsed = memberUpdateSchema.safeParse(update);
      if (!parsed.success) {
        page.showProblems(fieldProblems(parsed.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => editMember({ data: { ...update, roles: parsed.data.roles } }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Editar persona"
      description={member.name}
      submitLabel="Guardar"
      action={action}
    >
      <form.AppField name="roles">
        {(field) => <field.CheckboxGroupField legend="Roles" options={roleOptions} />}
      </form.AppField>
      {settings && (
        <>
          <h2 className="text-lg font-semibold">Profesional</h2>
          <form.AppField name="displayName">
            {(field) => <field.TextField label="Nombre a mostrar" required />}
          </form.AppField>
          <form.AppField name="specialty">
            {(field) => <field.TextField label="Especialidad" />}
          </form.AppField>
          <form.AppField name="gridMinutes">
            {(field) => (
              <field.TextField
                label="Intervalo de turnos (minutos)"
                type="number"
                min={5}
                max={120}
                required
                narrow
                hint="Los horarios libres empiezan cada tantos minutos, contados desde la medianoche."
              />
            )}
          </form.AppField>
          <form.AppField name="color">
            {(field) => (
              <field.SelectField
                label="Color en la agenda"
                beside={<ColorSwatch color={field.state.value as PractitionerColor} />}
              >
                {practitionerColors.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {practitionerColorLabels[option]}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField name="keepsClinicalRecords">
            {(field) => <field.CheckboxField label="Lleva historia clínica" />}
          </form.AppField>
        </>
      )}
    </ActionFormPage>
  );
}
