import { createFileRoute, redirect } from "@tanstack/react-router";

// Every role opens on the calendar.
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    throw redirect({ to: "/agenda" });
  },
});
