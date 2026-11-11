import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { cancellerLabels } from "#/lib/appointment-statuses.ts";
import {
  appointmentCancellers,
  cancellationReasonMaxLength,
  cancellationSchema,
} from "#/lib/appointments.ts";
import { getAppointmentRecord, markAppointmentCancelled } from "#/server/appointments.functions.ts";

import {
  AppointmentPage,
  appointmentBack,
  appointmentSummary,
} from "#/routes/_app/agenda/-appointment-page.tsx";
import type { LoadedAppointment } from "#/routes/_app/agenda/-appointment-page.tsx";
import { statusRefusalMessages } from "#/routes/_app/agenda/-appointment-status.tsx";

// Cancelling an appointment: who cancels, and why if the user says.

export const Route = createFileRoute("/_app/agenda/turnos/$appointmentId/cancelar")({
  head: () => ({ meta: [{ title: "Cancelar turno · underthing" }] }),
  loader: ({ params }) => getAppointmentRecord({ data: { appointmentId: params.appointmentId } }),
  component: CancelAppointment,
});

const fieldMessages = {
  cancelledBy: "Elegí quién cancela.",
  reason: `El motivo puede tener hasta ${cancellationReasonMaxLength} caracteres.`,
};

function CancelAppointment() {
  return (
    <AppointmentPage loaded={Route.useLoaderData()}>
      {(loaded) =>
        loaded.appointment.actions.includes("cancelled") ? (
          <CancelForm loaded={loaded} />
        ) : (
          <RefusalMessage message="Ese turno ya no se puede cancelar." />
        )
      }
    </AppointmentPage>
  );
}

function CancelForm({ loaded }: { loaded: LoadedAppointment }) {
  const page = useFormPage(appointmentBack);
  const action = useFormAction(statusRefusalMessages, { invalidInput: "reason" });

  const form = useAppForm({
    defaultValues: { cancelledBy: "patient", reason: "" },
    onSubmit: async ({ value }) => {
      const input = cancellationSchema.safeParse({
        ...value,
        appointmentId: loaded.appointment.id,
      });
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => markAppointmentCancelled({ data: input.data }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Cancelar turno"
      description={appointmentSummary(loaded)}
      submitLabel="Cancelar turno"
      action={action}
    >
      <form.AppField name="cancelledBy">
        {(field) => (
          <field.SelectField label="¿Quién cancela?" required>
            {appointmentCancellers.map((canceller) => (
              <NativeSelectOption key={canceller} value={canceller}>
                {cancellerLabels[canceller]}
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="reason">
        {(field) => (
          <field.TextField label="Motivo (opcional)" maxLength={cancellationReasonMaxLength} />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
