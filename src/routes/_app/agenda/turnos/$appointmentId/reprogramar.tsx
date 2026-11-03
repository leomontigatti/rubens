import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { getAppointmentRecord } from "#/server/appointments.functions.ts";

import { AppointmentPage } from "#/routes/_app/agenda/-appointment-page.tsx";
import { ReschedulePage } from "#/routes/_app/agenda/-reschedule.tsx";

export const Route = createFileRoute("/_app/agenda/turnos/$appointmentId/reprogramar")({
  head: () => ({ meta: [{ title: "Reprogramar turno · Rubens" }] }),
  loader: ({ params }) => getAppointmentRecord({ data: { appointmentId: params.appointmentId } }),
  component: RescheduleAppointment,
});

function RescheduleAppointment() {
  return (
    <AppointmentPage loaded={Route.useLoaderData()}>
      {(loaded) =>
        // Rescheduling is open to whoever may cancel: a booked or confirmed appointment.
        loaded.appointment.actions.includes("cancelled") ? (
          <ReschedulePage loaded={loaded} />
        ) : (
          <RefusalMessage message="Solo se reprograma un turno reservado o confirmado." />
        )
      }
    </AppointmentPage>
  );
}
