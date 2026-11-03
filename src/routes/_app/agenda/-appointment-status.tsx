import { Link } from "@tanstack/react-router";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  appointmentStatusLabels,
  cancellationText,
  statusActionLabels,
} from "#/lib/appointment-statuses.ts";
import { setAppointmentStatus, undoStatusChange } from "#/server/appointments.functions.ts";
import type { DayAppointment } from "#/server/appointments.ts";

import { StatusIcon } from "#/routes/_app/agenda/-status.tsx";

// An appointment's status in its dialog: what it is, the changes the viewer
// may make now, a link to cancelling it, and the same-day undo.

export const statusRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Tu rol no permite ese cambio en este turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el motivo de la cancelación.",
  notFound: "No encontramos ese turno.",
  notAllowed: "El turno ya cambió de estado. Volvé a abrirlo.",
  beforeStart: "Un turno se marca ausente recién después de su hora.",
  nothingToUndo: "No hay un cambio para deshacer.",
  tooLate: "Un cambio de estado solo se deshace el mismo día.",
  timeTaken: "Ese horario ya se ocupó con otro turno: no se puede volver atrás.",
  roomFull: "El consultorio ya no tiene lugar a esa hora: no se puede volver atrás.",
  roomInactive: "El consultorio del turno está desactivado: no se puede volver atrás.",
  officeInactive: "La sede del turno está desactivada: no se puede volver atrás.",
};

export function StatusSection(props: { appointment: DayAppointment; onDone: () => void }) {
  const { appointment } = props;
  const { run, pending, error } = useFormAction(statusRefusalMessages);

  async function act(action: () => ReturnType<typeof setAppointmentStatus>) {
    if (await run(action)) {
      props.onDone();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusLine appointment={appointment} />
      <div className="flex flex-wrap gap-2">
        {appointment.actions.map((status) =>
          status === "cancelled" ? (
            <Button
              key={status}
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/agenda/turnos/$appointmentId/cancelar"
                  params={{ appointmentId: appointment.id }}
                />
              }
            >
              {statusActionLabels[status]}
            </Button>
          ) : (
            <Button
              key={status}
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                void act(() =>
                  setAppointmentStatus({ data: { appointmentId: appointment.id, status } }),
                )
              }
            >
              {statusActionLabels[status]}
            </Button>
          ),
        )}
        {appointment.undoStatus && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              void act(() => undoStatusChange({ data: { appointmentId: appointment.id } }))
            }
          >
            Deshacer (volver a {appointmentStatusLabels[appointment.undoStatus]})
          </Button>
        )}
      </div>
      <ErrorAlert message={error} />
    </div>
  );
}

function StatusLine({ appointment }: { appointment: DayAppointment }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="flex items-center gap-1.5">
        <StatusIcon status={appointment.status} />
        <span className="font-medium">{appointmentStatusLabels[appointment.status]}</span>
      </p>
      <p className="text-muted-foreground">{cancellationText(appointment)}</p>
    </div>
  );
}
