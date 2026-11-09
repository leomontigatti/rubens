import { createFileRoute } from "@tanstack/react-router";

import {
  BookingRoute,
  bookingSearchSchema,
  loadBooking,
} from "#/routes/_app/agenda/-booking-route.tsx";

export const Route = createFileRoute("/_app/agenda/turnos/nuevo")({
  head: () => ({ meta: [{ title: "Nuevo turno · underthing" }] }),
  validateSearch: bookingSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadBooking(deps),
  component: NewAppointment,
});

function NewAppointment() {
  return <BookingRoute loaded={Route.useLoaderData()} overbooking={false} />;
}
