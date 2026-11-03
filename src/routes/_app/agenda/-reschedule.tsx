import { tz } from "@date-fns/tz";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { format } from "date-fns";
import { useState } from "react";

import { useAppForm } from "#/components/app-form.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { durationMinutesSchema } from "#/lib/availability.ts";
import { rescheduleQueryOf } from "#/lib/booking-draft.ts";
import type { BookingWarning, PickedStart } from "#/lib/booking-draft.ts";
import { moveAppointment } from "#/server/appointments.functions.ts";

import { appointmentBack, appointmentSummary } from "#/routes/_app/agenda/-appointment-page.tsx";
import type { LoadedAppointment } from "#/routes/_app/agenda/-appointment-page.tsx";
import { PatientWarnings } from "#/routes/_app/agenda/-booking.tsx";
import { FreeStartsOfWeek, StartGroup } from "#/routes/_app/agenda/-free-starts.tsx";

// Rescheduling an appointment through the free-times picker: a new free time
// of the same practitioner, a week from a date, which brings its schedule's
// room and office. The appointment's own time counts as free.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden reprogramar.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la duración.",
  notFound: "Solo se reprograma un turno reservado o confirmado.",
  practitionerInactive: "Ese profesional está inactivo. Un administrador puede reactivarlo.",
  patientInactive: "Ese paciente está inactivo. Un administrador puede reactivarlo.",
  medicalServiceInactive: "Esa prestación está desactivada.",
  notFree: "Ese horario ya no está libre para esa duración. Elegí otro.",
  roomRequired: "Ese horario está fuera de los horarios del profesional.",
  timeOff: "El profesional no atiende a esa hora: tiene una ausencia cargada.",
  closed: "La sede está cerrada a esa hora.",
  roomInactive: "Ese consultorio está desactivado.",
  officeInactive: "La sede de ese consultorio está desactivada.",
  roomFull: "Ese consultorio no tiene lugar a esa hora.",
  timeTaken: "Ese horario ya se ocupó. Elegí otro horario libre.",
};

type RefusalReason = keyof typeof refusalMessages;

/** The refusals about no field: who or what is inactive, or the request itself. */
const generalRefusals: readonly RefusalReason[] = [
  "unauthenticated",
  "forbidden",
  "mustChangePassword",
  "notFound",
  "practitionerInactive",
  "patientInactive",
  "medicalServiceInactive",
];

function refusalOf(reason: RefusalReason): FieldProblem {
  if (reason === "invalidInput") {
    return { field: "durationMinutes", message: refusalMessages.invalidInput };
  }
  return {
    field: generalRefusals.includes(reason) ? "" : "start",
    message: refusalMessages[reason],
  };
}

/** What the last attempt answered: warnings to confirm past, or a refusal. */
interface Answer {
  warnings: BookingWarning[] | null;
  refusal: FieldProblem | null;
}

const noAnswer: Answer = { warnings: null, refusal: null };

interface RescheduleValues {
  durationMinutes: string;
  freeFrom: string;
  start: PickedStart | null;
}

/** What the form's check refuses, under each field. */
function problemsOf(values: RescheduleValues): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (!durationMinutesSchema.safeParse(Number(values.durationMinutes)).success) {
    problems.push({
      field: "durationMinutes",
      message: "La duración tiene que ser un número entero de minutos, entre 1 y 720.",
    });
  }
  if (!values.start) {
    problems.push({ field: "start", message: "Elegí un horario libre." });
  }
  return problems;
}

function minutesOf(appointment: { start: Date; end: Date }): number {
  return (+appointment.end - +appointment.start) / 60_000;
}

export function ReschedulePage({ loaded }: { loaded: LoadedAppointment }) {
  const { appointment, office } = loaded;
  const page = useFormPage(appointmentBack);
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<Answer>(noAnswer);
  const [pending, setPending] = useState(false);

  async function reschedule(values: RescheduleValues, confirmWarnings: boolean) {
    page.clearProblems();
    setAnswer(noAnswer);
    const problems = problemsOf(values);
    if (!values.start || problems.length > 0) {
      page.showProblems(problems);
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof moveAppointment>>;
    try {
      result = await moveAppointment({
        data: {
          appointmentId: appointment.id,
          start: values.start.start,
          durationMinutes: Number(values.durationMinutes),
          confirmWarnings,
        },
      });
    } finally {
      setPending(false);
    }
    if (result.ok) {
      page.leave();
    } else {
      await settle(result);
    }
  }

  async function settle(
    refusal: Exclude<Awaited<ReturnType<typeof moveAppointment>>, { ok: true }>,
  ) {
    if (refusal.reason === "patientWarning") {
      setAnswer({ warnings: refusal.warnings, refusal: null });
      return;
    }
    // A refusal drops the pick, and the picker reloads the free times.
    form.setFieldValue("start", null);
    setAnswer({ warnings: null, refusal: refusalOf(refusal.reason) });
    await queryClient.invalidateQueries({ queryKey: ["freeTimes"] });
  }

  const form = useAppForm({
    defaultValues: {
      durationMinutes: String(minutesOf(appointment)),
      freeFrom: format(appointment.start, "yyyy-MM-dd", { in: tz(office.timeZone) }),
      start: null as PickedStart | null,
    },
    listeners: { onChange: () => setAnswer(noAnswer) },
    onSubmit: ({ value }) => reschedule(value, false),
  });
  const query = useStore(form.store, (state) =>
    rescheduleQueryOf(
      { id: appointment.id, practitionerId: appointment.practitionerId },
      state.values.freeFrom,
      Number(state.values.durationMinutes),
    ),
  );

  return (
    <FormPage
      page={page}
      form={form}
      title="Reprogramar turno"
      description={appointmentSummary(loaded)}
      submitLabel="Reprogramar"
      pending={pending}
      refusals={answer.refusal ? [answer.refusal] : undefined}
      onClear={() => setAnswer(noAnswer)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField
          name="durationMinutes"
          listeners={{ onChange: () => form.setFieldValue("start", null) }}
        >
          {(field) => (
            <field.TextField label="Duración (minutos)" type="number" min={1} max={720} required />
          )}
        </form.AppField>
        <form.AppField name="freeFrom">
          {(field) => <field.TextField label="Horarios libres desde" type="date" />}
        </form.AppField>
      </div>
      <form.Field name="start">
        {(field) => (
          <StartGroup>
            {query && (
              <FreeStartsOfWeek
                query={query}
                picked={field.state.value}
                onPick={field.handleChange}
              />
            )}
          </StartGroup>
        )}
      </form.Field>
      <PatientWarnings
        warnings={answer.warnings}
        pending={pending}
        onConfirm={() => void reschedule(form.state.values, true)}
        confirmLabel="Reprogramar igual"
      />
    </FormPage>
  );
}
