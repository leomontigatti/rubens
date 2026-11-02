import { Link, createFileRoute } from "@tanstack/react-router";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { practitionerColorLabels } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { rolesLabel } from "#/lib/staff.ts";
import { changeMemberActive, getMember, getMemberUpcomingCount } from "#/server/staff.functions.ts";
import type { PractitionerSettings, StaffMember } from "#/server/staff.ts";

import { ColorSwatch, RefusalAlert, useAction } from "#/routes/_app/personal/-shared.tsx";

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
        <PractitionerSection settings={member.practitioner} />
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
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/personal/$memberId/editar" params={{ memberId: member.memberId }} />
              }
            >
              Editar
            </Button>
            <ActiveAction member={member} pending={toggle.pending} onChange={changeActive} />
          </>
        }
      />
      <ErrorAlert message={toggle.error} />
    </div>
  );
}

function ActiveAction(props: {
  member: StaffMember;
  pending: boolean;
  onChange: (active: boolean) => unknown;
}) {
  const { member, pending } = props;
  if (member.active) {
    return (
      <DeactivateButton
        key={member.memberId}
        question={`¿Desactivar a ${member.name}?`}
        pending={pending}
        countUpcoming={() => getMemberUpcomingCount({ data: { memberId: member.memberId } })}
        onDeactivate={() => void props.onChange(false)}
      />
    );
  }
  return (
    <Button variant="outline" disabled={pending} onClick={() => void props.onChange(true)}>
      Reactivar
    </Button>
  );
}

function RolesSection({ member }: { member: StaffMember }) {
  return (
    <RecordSection title="Roles">
      <p>{rolesLabel(member.roles)}</p>
    </RecordSection>
  );
}

function PractitionerSection({ settings }: { settings: PractitionerSettings }) {
  return (
    <RecordSection title="Profesional">
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

function StartingPasswordSection({ memberId }: { memberId: string }) {
  return (
    <RecordSection
      title="Contraseña inicial"
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/personal/$memberId/contrasena" params={{ memberId }} />}
        >
          Asignar
        </Button>
      }
    >
      <p className="text-muted-foreground">
        Reemplaza la contraseña actual. La persona la usa para ingresar y la cambia al entrar.
      </p>
    </RecordSection>
  );
}
