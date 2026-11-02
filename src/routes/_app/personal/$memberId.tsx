import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert, FormActions, fieldMessage } from "#/components/admin-form.tsx";
import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import { FormSheet } from "#/components/form-sheet.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  practitionerColorClasses,
  practitionerColorLabels,
  practitionerColors,
} from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { practitionerUpdateSchema, rolesChangeSchema, rolesLabel } from "#/lib/staff.ts";
import type { PractitionerUpdate } from "#/lib/staff.ts";
import {
  changeMemberActive,
  editPractitioner,
  editRoles,
  getMember,
  getMemberUpcomingCount,
  resetStartingPassword,
} from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/server/staff.ts";

import {
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  useAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.ok ? `${loaderData.member.name} · Rubens` : "Personal · Rubens" }],
  }),
  component: StaffMemberScreen,
});

function StaffMemberScreen() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const { member } = result;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <MemberHeading member={member} />
      <RolesSection member={member} />
      {member.practitioner && member.roles.includes("practitioner") && (
        <PractitionerSection memberId={member.memberId} settings={member.practitioner} />
      )}
      <StartingPasswordSection memberId={member.memberId} />
    </div>
  );
}

function MemberHeading({ member }: { member: StaffMember }) {
  const toggle = useAction();

  function changeActive(active: boolean) {
    return toggle.run(() => changeMemberActive({ data: { memberId: member.memberId, active } }));
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        back={{ to: "/personal", label: "Personal" }}
        title={member.name}
        status={!member.active && <Badge variant="secondary">Inactivo</Badge>}
        description={<p className="text-muted-foreground text-sm">{member.email}</p>}
        actions={
          member.active ? (
            <DeactivateButton
              key={member.memberId}
              question={`¿Desactivar a ${member.name}?`}
              pending={toggle.pending}
              countUpcoming={() => getMemberUpcomingCount({ data: { memberId: member.memberId } })}
              onDeactivate={() => void changeActive(false)}
            />
          ) : (
            <Button
              variant="outline"
              disabled={toggle.pending}
              onClick={() => void changeActive(true)}
            >
              Reactivar
            </Button>
          )
        }
      />
      <ErrorAlert message={toggle.error} />
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Editar
    </Button>
  );
}

function RolesSection({ member }: { member: StaffMember }) {
  const [editing, setEditing] = useState(false);
  return (
    <RecordSection title="Roles" action={<EditButton onClick={() => setEditing(true)} />}>
      <p>{rolesLabel(member.roles)}</p>
      <FormSheet open={editing} onClose={() => setEditing(false)} title="Editar roles">
        <RolesForm member={member} onDone={() => setEditing(false)} />
      </FormSheet>
    </RecordSection>
  );
}

function RolesForm({ member, onDone }: { member: StaffMember; onDone: () => void }) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = rolesChangeSchema.safeParse({
      memberId: member.memberId,
      roles: formRoles(new FormData(event.currentTarget)),
    });
    if (!input.success) {
      action.setError("Elegí al menos un rol.");
      return;
    }
    if (await action.run(() => editRoles({ data: input.data }))) {
      onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <RoleCheckboxes idPrefix={member.memberId} initial={member.roles} />
      <FormActions pending={action.pending} submitLabel="Guardar" onCancel={onDone} />
    </form>
  );
}

const practitionerFieldMessages: Record<keyof PractitionerUpdate, string> = {
  memberId: "No encontramos a esa persona.",
  displayName: "Ingresá el nombre a mostrar.",
  specialty: "La especialidad es demasiado larga.",
  keepsClinicalRecords: "Revisá los datos ingresados.",
  gridMinutes: "El intervalo tiene que ser un número de minutos entre 5 y 120.",
  color: "Elegí un color.",
};

function PractitionerSection(props: { memberId: string; settings: PractitionerSettings }) {
  const { settings } = props;
  const [editing, setEditing] = useState(false);
  return (
    <RecordSection title="Profesional" action={<EditButton onClick={() => setEditing(true)} />}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Nombre a mostrar" value={settings.displayName} />
        <Detail label="Especialidad" value={settings.specialty} />
        <Detail label="Intervalo de turnos" value={`${settings.gridMinutes} minutos`} />
        <Detail label="Color en la agenda" value={<ColorName color={settings.color} />} />
        <Detail
          label="Historia clínica"
          value={settings.keepsClinicalRecords ? "La lleva" : "No la lleva"}
        />
      </dl>
      <FormSheet open={editing} onClose={() => setEditing(false)} title="Editar profesional">
        <PractitionerForm
          memberId={props.memberId}
          settings={settings}
          onDone={() => setEditing(false)}
        />
      </FormSheet>
    </RecordSection>
  );
}

function ColorName({ color }: { color: PractitionerColor }) {
  return (
    <span className="flex items-center gap-2">
      {practitionerColorLabels[color]}
      <ColorSwatch color={color} />
    </span>
  );
}

function ColorSwatch({ color }: { color: PractitionerColor }) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0 rounded-full", practitionerColorClasses[color])}
    />
  );
}

function PractitionerForm(props: {
  memberId: string;
  settings: PractitionerSettings;
  onDone: () => void;
}) {
  const action = useAction();
  const { settings } = props;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const update = {
      memberId: props.memberId,
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
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
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
      <FormActions pending={action.pending} submitLabel="Guardar" onCancel={props.onDone} />
    </form>
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

function StartingPasswordSection({ memberId }: { memberId: string }) {
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState(false);

  function open() {
    setDone(false);
    setAssigning(true);
  }

  return (
    <RecordSection
      title="Contraseña inicial"
      action={
        <Button variant="outline" size="sm" onClick={open}>
          Asignar
        </Button>
      }
    >
      {done ? (
        <Alert variant="success">
          <AlertTitle>Listo</AlertTitle>
          <AlertDescription>
            La persona tiene que cambiarla la próxima vez que ingrese.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground">
          Reemplaza la contraseña actual. La persona la usa para ingresar y la cambia al entrar.
        </p>
      )}
      <FormSheet
        open={assigning}
        onClose={() => setAssigning(false)}
        title="Asignar contraseña inicial"
      >
        <StartingPasswordForm
          memberId={memberId}
          onCancel={() => setAssigning(false)}
          onDone={() => {
            setAssigning(false);
            setDone(true);
          }}
        />
      </FormSheet>
    </RecordSection>
  );
}

function StartingPasswordForm(props: {
  memberId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password") as string;
    const { memberId } = props;
    if (await action.run(() => resetStartingPassword({ data: { memberId, password } }))) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <Field>
        <FieldLabel htmlFor="password">Contraseña inicial nueva</FieldLabel>
        <Input id="password" name="password" type="text" autoComplete="off" required />
      </Field>
      <FormActions pending={action.pending} submitLabel="Asignar" onCancel={props.onCancel} />
    </form>
  );
}
