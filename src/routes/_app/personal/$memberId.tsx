import { Link, createFileRoute } from "@tanstack/react-router";

import { activeRecord } from "#/components/admin-form.tsx";
import { pickedIn, useAppForm } from "#/components/app-form.tsx";
import { ColorSwatch } from "#/components/color-swatch.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { Button } from "#/components/ui/button.tsx";
import { practitionerColorLabels, practitionerColors } from "#/lib/practitioner-colors.ts";
import { isOneOf } from "#/lib/is-one-of.ts";
import { memberUpdateSchema } from "#/lib/staff.ts";
import {
  changeMemberActive,
  editMember,
  getMember,
  getMemberUpcomingCount,
} from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/organization/staff.ts";

import {
  RefusalAlert,
  roleOptions,
  useAction,
  useEditAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: () => ({ meta: [{ title: "Editar persona · underthing" }] }),
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

const colorOptions = practitionerColors.map((color) => ({
  value: color,
  label: practitionerColorLabels[color],
  mark: <ColorSwatch color={color} />,
}));

const settingsKeys = [
  "displayName",
  "specialty",
  "gridMinutes",
  "color",
  "keepsClinicalRecords",
] as const satisfies readonly (keyof SettingsValues)[];

const sameRoles = (roles: string[], saved: readonly string[]) =>
  roles.length === saved.length && roles.every((role) => saved.includes(role));

function changedSettings(values: SettingsValues, saved: PractitionerSettings | null) {
  if (!saved) {
    return undefined;
  }
  const opened = settingsValues(saved);
  const same = settingsKeys.every((key) => values[key] === opened[key]);
  if (same) {
    return undefined;
  }
  return {
    displayName: values.displayName,
    specialty: values.specialty,
    keepsClinicalRecords: values.keepsClinicalRecords,
    gridMinutes: Number(values.gridMinutes),
    color: isOneOf(practitionerColors, values.color) ? values.color : saved.color,
  };
}

/**
 * Only what the user changed, over the member as last loaded: a field they did
 * not touch takes the loaded value, so a reload under the form (another admin's
 * change, the header's deactivation) is never written back as theirs.
 */
function changesIn(
  values: MemberValues,
  member: StaffMember,
  edited: (field: keyof MemberValues) => boolean,
) {
  const saved = shownSettings(member);
  const loaded = settingsValues(saved);
  const pick = <Key extends keyof SettingsValues>(key: Key) =>
    edited(key) ? values[key] : loaded[key];
  const settings: SettingsValues = {
    displayName: pick("displayName"),
    specialty: pick("specialty"),
    gridMinutes: pick("gridMinutes"),
    color: pick("color"),
    keepsClinicalRecords: pick("keepsClinicalRecords"),
  };
  return {
    roles: edited("roles") && !sameRoles(values.roles, member.roles) ? values.roles : undefined,
    practitioner: changedSettings(settings, saved),
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

/**
 * The member's only page, as the list opens it: their status, the starting
 * password and the deactivation beside the title.
 */
function useMemberRecord(member: StaffMember): RecordHeader {
  const { memberId } = member;
  const toggle = useAction();
  const active = activeRecord({
    active: member.active,
    inactiveLabel: "Inactivo",
    toggle,
    onChange: (next) =>
      void toggle.run(() => changeMemberActive({ data: { memberId, active: next } })),
    deactivation: {
      question: `¿Desactivar a ${member.name}?`,
      countUpcoming: () => getMemberUpcomingCount({ data: { memberId } }),
    },
  });
  return {
    ...active,
    actions: (busy) => (
      <>
        <Button
          variant="outline"
          disabled={busy}
          nativeButton={false}
          render={<Link to="/personal/$memberId/contrasena" params={{ memberId }} />}
        >
          Asignar contraseña inicial
        </Button>
        {active.actions(busy)}
      </>
    ),
  };
}

function MemberForm({ member }: { member: StaffMember }) {
  const { memberId } = member;
  const page = useFormPage({ to: "/personal" });
  const record = useMemberRecord(member);
  const action = useEditAction();
  const settings = shownSettings(member);
  const defaultValues: MemberValues = {
    ...settingsValues(settings),
    roles: pickedIn(roleOptions, member.roles),
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      const edited = (field: keyof MemberValues) => formApi.getFieldMeta(field)?.isDirty === true;
      const update = { memberId, ...changesIn(value, member, edited) };
      const parsed = memberUpdateSchema.safeParse(update);
      if (!parsed.success) {
        page.showProblems(fieldProblems(parsed.error.issues, messageIn(fieldMessages)));
        return;
      }
      const saved = await action.save(async () => {
        const result = await editMember({ data: { ...update, roles: parsed.data.roles } });
        // Still a practitioner, they stay the last clinical contact by the setting, not the role.
        return !result.ok &&
          result.reason === "lastClinicalContact" &&
          value.roles.includes("practitioner")
          ? { ok: false, reason: "lastClinicalContactSetting" }
          : result;
      });
      if (saved) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Editar persona"
      description={`${member.name} · ${member.email}`}
      submitLabel="Guardar"
      action={action}
      record={record}
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
            {(field) => <field.TextField label="Especialidad" size="half" />}
          </form.AppField>
          <form.AppField name="gridMinutes">
            {(field) => (
              <field.TextField
                label="Intervalo de turnos (minutos)"
                type="number"
                min={5}
                max={120}
                required
                startsRow
                hint="Los horarios libres empiezan cada tantos minutos, contados desde la medianoche."
              />
            )}
          </form.AppField>
          <form.AppField name="color">
            {(field) => (
              <field.MarkedSelectField label="Color en la agenda" options={colorOptions} />
            )}
          </form.AppField>
          <form.AppField name="keepsClinicalRecords">
            {(field) => <field.CheckboxField label="Lleva historias clínicas" startsRow />}
          </form.AppField>
        </>
      )}
    </ActionFormPage>
  );
}
