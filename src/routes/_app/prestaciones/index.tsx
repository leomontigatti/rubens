import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { getMedicalServicePractitioners } from "#/server/medical-services.functions.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/")({
  head: () => ({ meta: [{ title: "Prestaciones · Rubens" }] }),
  loader: () => getMedicalServicePractitioners(),
  component: MedicalServicePractitioners,
});

function MedicalServicePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Prestaciones</h1>
      {result.practitioners.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay profesionales.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.practitioners.map((practitioner) => (
            <li key={practitioner.id}>
              <Card>
                <CardContent>
                  <Link
                    to="/prestaciones/$practitionerId"
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
