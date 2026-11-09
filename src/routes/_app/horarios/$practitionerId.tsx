import { ClockIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { ErrorAlert } from "#/components/admin-form.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { scheduleState, today, validityLabel, weekdaysLabel } from "#/lib/schedules.ts";
import { getSchedules, removeSchedule } from "#/server/schedules.functions.ts";
import type { RoomOption, Schedule } from "#/organization/schedules.ts";

import { RefusalAlert, useAction } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/$practitionerId")({
  loader: ({ params }) => getSchedules({ data: { practitionerId: params.practitionerId } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `Horarios de ${loaderData.practitioner.displayName} · underthing`
          : "Horarios · underthing",
      },
    ],
  }),
  component: PractitionerSchedules,
});

function PractitionerSchedules() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const { practitioner, schedules, rooms } = result;
  const canEdit = practitioner.canEdit && practitioner.active;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ to: "/horarios", label: "Horarios" }}
        title={practitioner.displayName}
        description="Qué días y en qué consultorio atiende cada semana."
        actions={
          <CreateButton
            can={canEdit}
            link={
              <Link
                to="/horarios/$practitionerId/nuevo"
                params={{ practitionerId: practitioner.id }}
              />
            }
          >
            Nuevo horario
          </CreateButton>
        }
      />
      {schedules.length === 0 ? (
        <NoSchedules practitionerId={practitioner.id} canEdit={canEdit} rooms={rooms} />
      ) : (
        <ul className="flex flex-col gap-3">
          {schedules.map((schedule) => (
            <ScheduleItem key={schedule.id} schedule={schedule} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A schedule needs an active room, so with none that comes first. */
function NoSchedules(props: { practitionerId: string; canEdit: boolean; rooms: RoomOption[] }) {
  const isAdmin = Route.useRouteContext().viewer.roles.includes("admin");
  if (!props.canEdit) {
    return (
      <EmptyState icon={ClockIcon} title="Sin horarios" description="Todavía no tiene horarios." />
    );
  }
  if (props.rooms.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="Sin horarios"
        description={
          isAdmin
            ? "Todavía no tiene horarios. Empezá agregando un consultorio activo en Sedes."
            : "Todavía no tiene horarios, y antes hace falta un consultorio activo."
        }
      >
        {isAdmin && <EmptyStateLink link={<Link to="/sedes" />}>Ir a Sedes</EmptyStateLink>}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={ClockIcon}
      title="Sin horarios"
      description="Todavía no tiene horarios. Empezá creando el primero."
    >
      <CreateButton
        link={
          <Link
            to="/horarios/$practitionerId/nuevo"
            params={{ practitionerId: props.practitionerId }}
          />
        }
      >
        Nuevo horario
      </CreateButton>
    </EmptyState>
  );
}

function ScheduleItem(props: { schedule: Schedule; canEdit: boolean }) {
  const { schedule } = props;
  const state = scheduleState(schedule, today(schedule.timeZone));

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <ScheduleSummary schedule={schedule} ended={state.ended}>
            {props.canEdit && !state.ended && (
              <ScheduleActions schedule={schedule} deletable={!state.started} />
            )}
          </ScheduleSummary>
        </CardContent>
      </Card>
    </li>
  );
}

function ScheduleSummary(props: { schedule: Schedule; ended: boolean; children: ReactNode }) {
  const { schedule } = props;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {weekdaysLabel(schedule.weekdays)} · {schedule.startTime} a {schedule.endTime}
        </span>
        <span className="text-muted-foreground text-sm">
          {schedule.roomName} · {schedule.officeName}
        </span>
        <span className="text-muted-foreground text-sm">
          {validityLabel(schedule)}
          {props.ended && " · Terminado"}
        </span>
      </div>
      {props.children}
    </div>
  );
}

/** Change, end and, before the first date, delete. */
function ScheduleActions(props: { schedule: Schedule; deletable: boolean }) {
  const remove = useAction();
  const [confirming, setConfirming] = useState(false);
  const { practitionerId } = Route.useParams();
  const params = { practitionerId, scheduleId: props.schedule.id };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/horarios/$practitionerId/$scheduleId/cambiar" params={params} />}
        >
          Cambiar
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/horarios/$practitionerId/$scheduleId/terminar" params={params} />}
        >
          Terminar
        </Button>
        {props.deletable && (
          <Button
            variant="outline"
            size="sm"
            disabled={remove.pending}
            onClick={() => setConfirming(true)}
          >
            Eliminar
          </Button>
        )}
      </div>
      <ErrorAlert message={remove.error} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Eliminar este horario?"
        description="El horario se borra y no se puede recuperar. Si tiene turnos, salvo sobreturnos, pasan a Turnos a reprogramar."
        confirmLabel="Eliminar"
        onConfirm={() =>
          void remove.run(() => removeSchedule({ data: { scheduleId: props.schedule.id } }))
        }
      />
    </div>
  );
}
