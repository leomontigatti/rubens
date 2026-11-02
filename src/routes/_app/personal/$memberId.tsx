import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ErrorAlert, fieldMessage } from "#/components/admin-form.tsx";
import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
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
import { practitionerUpdateSchema, rolesChangeSchema } from "#/lib/staff.ts";
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

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function RolesSection({ member }: { member: StaffMember }) {
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
    await action.run(() => editRoles({ data: input.data }));
  }

  return (
    <Section title="Roles">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <ErrorAlert message={action.error} />
        <RoleCheckboxes idPrefix={member.memberId} initial={member.roles} />
        <div>
          <Button type="submit" disabled={action.pending}>
            Guardar roles
          </Button>
        </div>
      </form>
    </Section>
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
    await action.run(() => editPractitioner({ data: update }));
  }

  return (
    <Section title="Profesional">
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
        <div>
          <Button type="submit" disabled={action.pending}>
            Guardar
          </Button>
        </div>
      </form>
    </Section>
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
        <span
          aria-hidden
          className={cn("size-4 shrink-0 rounded-full", practitionerColorClasses[color])}
        />
      </div>
    </Field>
  );
}

function StartingPasswordSection({ memberId }: { memberId: string }) {
  const action = useAction();
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get("password") as string;
    setDone(false);
    if (await action.run(() => resetStartingPassword({ data: { memberId, password } }))) {
      form.reset();
      setDone(true);
    }
  }

  return (
    <Section title="Contraseña inicial">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <ErrorAlert message={action.error} />
        {done && (
          <Alert variant="success">
            <AlertTitle>Listo</AlertTitle>
            <AlertDescription>
              La persona tiene que cambiarla la próxima vez que ingrese.
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="password">Contraseña inicial nueva</FieldLabel>
          <Input
            id="password"
            name="password"
            type="text"
            autoComplete="off"
            required
            aria-describedby="password-hint"
          />
          <FieldDescription id="password-hint">
            Reemplaza la contraseña actual. La persona la usa para ingresar y la cambia al entrar.
          </FieldDescription>
        </Field>
        <div>
          <Button type="submit" disabled={action.pending}>
            Asignar contraseña inicial
          </Button>
        </div>
      </form>
    </Section>
  );
}
