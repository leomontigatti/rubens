import { createFileRoute } from "@tanstack/react-router";

import {
  BookingRoute,
  bookingSearchSchema,
  loadBooking,
} from "#/routes/_app/agenda/-booking-route.tsx";

export const Route = createFileRoute("/_app/agenda/sobreturnos/nuevo")({
  head: () => ({ meta: [{ title: "Sobreturno · underthing" }] }),
  validateSearch: bookingSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadBooking(deps),
  component: NewOverbooking,
});

function NewOverbooking() {
  return <BookingRoute loaded={Route.useLoaderData()} overbooking />;
}
