import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { getAppointmentTypePractitioners } from "#/server/appointment-types.functions.ts";

import { refusalMessages } from "#/routes/_app/tipos-de-turno/-shared.ts";

export const Route = createFileRoute("/_app/tipos-de-turno/")({
  head: () => ({ meta: [{ title: "Tipos de turno · Rubens" }] }),
  loader: () => getAppointmentTypePractitioners(),
  component: AppointmentTypePractitioners,
});

function AppointmentTypePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Tipos de turno</h1>
      {result.practitioners.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay profesionales.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.practitioners.map((practitioner) => (
            <li key={practitioner.id}>
              <Card>
                <CardContent>
                  <Link
                    to="/tipos-de-turno/$practitionerId"
                    params={{ practitionerId: practitioner.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {practitioner.displayName}
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
