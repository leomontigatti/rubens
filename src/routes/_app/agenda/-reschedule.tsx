import { tz } from "@date-fns/tz";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import { rescheduleQueryOf } from "#/lib/booking-draft.ts";
import type { BookingWarning, PickedStart } from "#/lib/booking-draft.ts";
import { moveAppointment } from "#/server/appointments.functions.ts";
import type { DayAppointment } from "#/server/appointments.ts";
import { getFreeTimes } from "#/server/availability.functions.ts";

import { FreeStartList, PatientWarnings } from "#/routes/_app/agenda/-booking.tsx";

// Rescheduling an appointment through the free-times picker: a new free time
// of the same practitioner, a week from a date, which brings its schedule's
// room and office. The appointment's own time counts as free.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden reprogramar.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la duración.",
  notFound: "Solo se reprograma un turno reservado o confirmado.",
  practitionerInactive: "Ese profesional está inactivo.",
  patientInactive: "Ese paciente está inactivo.",
  appointmentTypeInactive: "Ese tipo de turno está desactivado.",
  notFree: "Ese horario ya no está libre para esa duración. Elegí otro.",
  roomRequired: "Ese horario está fuera de los horarios del profesional.",
  timeOff: "El profesional no atiende a esa hora: tiene una ausencia cargada.",
  closed: "La sede está cerrada a esa hora.",
  roomInactive: "Ese consultorio está desactivado.",
  officeInactive: "La sede de ese consultorio está desactivada.",
  roomFull: "Ese consultorio no tiene lugar a esa hora.",
  timeTaken: "Ese horario ya se ocupó. Elegí otro horario libre.",
};

/** What the last attempt answered: warnings to confirm past, or a refusal. */
interface Answer {
  warnings: BookingWarning[] | null;
  error: string | null;
}

const noAnswer: Answer = { warnings: null, error: null };

function minutesOf(appointment: DayAppointment): number {
  return (+appointment.end - +appointment.start) / 60_000;
}

export function RescheduleForm(props: {
  appointment: DayAppointment;
  practitionerId: string;
  timeZone: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const { appointment } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [durationMinutes, setDurationMinutes] = useState(() => minutesOf(appointment));
  const [date, setDate] = useState(() =>
    format(appointment.start, "yyyy-MM-dd", { in: tz(props.timeZone) }),
  );
  const [picked, setPicked] = useState<PickedStart | null>(null);
  const [answer, setAnswer] = useState<Answer>(noAnswer);
  const [pending, setPending] = useState(false);

  async function reschedule(confirmWarnings: boolean) {
    if (!picked) {
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof moveAppointment>>;
    try {
      result = await moveAppointment({
        data: {
          appointmentId: appointment.id,
          start: picked.start,
          durationMinutes,
          confirmWarnings,
        },
      });
    } finally {
      setPending(false);
    }
    if (result.ok) {
      await router.invalidate();
      props.onDone();
    } else if (result.reason === "patientWarning") {
      setAnswer({ warnings: result.warnings, error: null });
    } else {
      // A refusal drops the pick, and the picker below reloads the free times.
      setPicked(null);
      setAnswer({ warnings: null, error: refusalMessages[result.reason] });
      await queryClient.invalidateQueries({ queryKey: ["freeTimes"] });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void reschedule(false);
  }

  function pick(start: PickedStart | null) {
    setPicked(start);
    setAnswer(noAnswer);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reschedule-duration">Duración (minutos)</Label>
          <Input
            id="reschedule-duration"
            type="number"
            min={1}
            max={720}
            value={durationMinutes}
            onChange={(event) => {
              setDurationMinutes(Number(event.target.value));
              pick(null);
            }}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reschedule-date">Horarios libres desde</Label>
          <Input
            id="reschedule-date"
            type="date"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
          />
        </div>
      </div>
      <FreeStartsOfWeek
        query={rescheduleQueryOf(
          { id: appointment.id, practitionerId: props.practitionerId },
          date,
          durationMinutes,
        )}
        picked={picked}
        onPick={pick}
      />
      <PatientWarnings
        warnings={answer.warnings}
        pending={pending}
        onConfirm={() => void reschedule(true)}
        confirmLabel="Reprogramar igual"
      />
      <ErrorAlert message={answer.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !picked}>
          Reprogramar
        </Button>
        <Button type="button" variant="ghost" onClick={props.onBack}>
          Volver
        </Button>
      </div>
    </form>
  );
}

/** The practitioner's free starts for the duration, a week from `firstDate`. */
function FreeStartsOfWeek(props: {
  query: AvailabilityQuery | null;
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  if (!props.query) {
    return null;
  }
  return <FreeStartsFor query={props.query} picked={props.picked} onPick={props.onPick} />;
}

function FreeStartsFor(props: {
  query: AvailabilityQuery;
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const { data } = useQuery({
    queryKey: ["freeTimes", viewer.organizationId, viewer.userId, props.query],
    queryFn: () => getFreeTimes({ data: props.query }),
    placeholderData: keepPreviousData,
  });

  if (!data) {
    return null;
  }
  if (!data.ok) {
    return <ErrorAlert message={refusalMessages.notFound} />;
  }
  if (data.freeStarts.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay horarios libres esa semana.</p>;
  }
  return <FreeStartList starts={data.freeStarts} picked={props.picked} onPick={props.onPick} />;
}
