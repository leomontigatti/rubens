import { tz } from "@date-fns/tz";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-form";
import { format } from "date-fns";
import { useState } from "react";

import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { rescheduleQueryOf, rescheduleRequestOf } from "#/lib/booking-draft.ts";
import type { BookingWarning, RescheduleValues } from "#/lib/booking-draft.ts";
import { moveAppointment } from "#/server/appointments.functions.ts";

import { appointmentBack, appointmentSummary } from "#/routes/_app/agenda/-appointment-page.tsx";
import type { LoadedAppointment } from "#/routes/_app/agenda/-appointment-page.tsx";
import { PatientWarnings, durationMessage } from "#/routes/_app/agenda/-booking.tsx";
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

/** What the form's check refused, under each field. */
function problemsOf(issues: Parameters<typeof fieldProblems>[0], values: RescheduleValues) {
  return fieldProblems(
    issues,
    messageIn({
      start: "Elegí un horario libre.",
      durationMinutes: durationMessage(values.durationMinutes),
    }),
  );
}

/** The appointment's own duration, and its free times from its own day, nothing picked yet. */
function initialValues({ appointment, office }: LoadedAppointment): RescheduleValues {
  return {
    durationMinutes: String((+appointment.end - +appointment.start) / 60_000),
    freeFrom: format(appointment.start, "yyyy-MM-dd", { in: tz(office.timeZone) }),
    start: null,
  };
}

export function ReschedulePage({ loaded }: { loaded: LoadedAppointment }) {
  const { appointment } = loaded;
  const page = useFormPage(appointmentBack);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<Answer>(noAnswer);
  const [pending, setPending] = useState(false);

  async function reschedule(values: RescheduleValues, confirmWarnings: boolean) {
    page.clearProblems();
    setAnswer(noAnswer);
    const request = rescheduleRequestOf(values, appointment.id);
    if (!request.success) {
      page.showProblems(problemsOf(request.error.issues, values));
      return;
    }
    setPending(true);
    const result = await serverAnswer("reschedule", shownPath(router), () =>
      moveAppointment({ data: { ...request.data, confirmWarnings } }),
    );
    setPending(false);
    if (!result) {
      return;
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
    defaultValues: initialValues(loaded),
    // A warning confirmed after a change would move it where it never warned about.
    // A refusal stays until the next submit.
    listeners: { onChange: () => setAnswer((last) => ({ ...last, warnings: null })) },
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
      <form.AppField
        name="durationMinutes"
        listeners={{ onChange: () => form.setFieldValue("start", null) }}
      >
        {(field) => (
          <field.TextField label="Duración (minutos)" type="number" min={1} max={720} required />
        )}
      </form.AppField>
      <form.AppField name="freeFrom">
        {(field) => <field.DateField label="Horarios libres desde" />}
      </form.AppField>
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
