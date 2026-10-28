import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  appointmentStatusLabels,
  cancellationText,
  cancellerLabels,
  statusActionLabels,
} from "#/lib/appointment-statuses.ts";
import { appointmentCancellers, cancellationReasonMaxLength } from "#/lib/appointments.ts";
import {
  markAppointmentCancelled,
  setAppointmentStatus,
  undoStatusChange,
} from "#/server/appointments.functions.ts";
import type { DayAppointment } from "#/server/appointments.ts";

import { StatusIcon } from "#/routes/_app/agenda/-status.tsx";

// An appointment's status in its dialog: what it is, the changes the viewer
// may make now, cancelling with who and why, and the same-day undo.

const refusalMessages = {
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
};

export function StatusSection(props: { appointment: DayAppointment; onDone: () => void }) {
  const { appointment } = props;
  const [cancelling, setCancelling] = useState(false);
  const { run, pending, error } = useFormAction(refusalMessages);

  async function act(action: () => ReturnType<typeof setAppointmentStatus>) {
    if (await run(action)) {
      props.onDone();
    }
  }

  if (cancelling) {
    return (
      <CancelForm
        appointmentId={appointment.id}
        onDone={props.onDone}
        onBack={() => setCancelling(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <StatusLine appointment={appointment} />
      <div className="flex flex-wrap gap-2">
        {appointment.actions.map((status) =>
          status === "cancelled" ? (
            <Button key={status} variant="outline" size="sm" onClick={() => setCancelling(true)}>
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

export function CancelForm(props: {
  appointmentId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const { run, pending, error } = useFormAction(refusalMessages);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cancelledBy = form.get("cancelledBy") === "business" ? "business" : "patient";
    const reason = form.get("reason");
    const data = {
      appointmentId: props.appointmentId,
      cancelledBy,
      reason: typeof reason === "string" ? reason : "",
    } as const;
    if (await run(() => markAppointmentCancelled({ data }))) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cancelled-by">¿Quién cancela?</Label>
        <NativeSelect id="cancelled-by" name="cancelledBy" defaultValue="patient">
          {appointmentCancellers.map((canceller) => (
            <NativeSelectOption key={canceller} value={canceller}>
              {cancellerLabels[canceller]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cancellation-reason">Motivo (opcional)</Label>
        <Input id="cancellation-reason" name="reason" maxLength={cancellationReasonMaxLength} />
      </div>
      <ErrorAlert message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          Cancelar turno
        </Button>
        <Button type="button" variant="ghost" onClick={props.onBack}>
          Volver
        </Button>
      </div>
    </form>
  );
}
