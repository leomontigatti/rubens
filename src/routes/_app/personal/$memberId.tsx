import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

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

function EditLink({ link }: { link: ReactElement }) {
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={link}>
      Editar
    </Button>
  );
}

function RolesSection({ member }: { member: StaffMember }) {
  const { memberId } = member;
  return (
    <RecordSection
      title="Roles"
      action={<EditLink link={<Link to="/personal/$memberId/roles" params={{ memberId }} />} />}
    >
      <p>{rolesLabel(member.roles)}</p>
    </RecordSection>
  );
}

function PractitionerSection(props: { memberId: string; settings: PractitionerSettings }) {
  const { settings, memberId } = props;
  return (
    <RecordSection
      title="Profesional"
      action={
        <EditLink link={<Link to="/personal/$memberId/profesional" params={{ memberId }} />} />
      }
    >
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
