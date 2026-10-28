import { Link, createFileRoute } from "@tanstack/react-router";

import { Card, CardContent } from "#/components/ui/card.tsx";
import { getSchedulePractitioners } from "#/server/schedules.functions.ts";

import { RefusalAlert } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/")({
  head: () => ({ meta: [{ title: "Horarios · Rubens" }] }),
  loader: () => getSchedulePractitioners(),
  component: SchedulePractitioners,
});

function SchedulePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Horarios</h1>
      {result.practitioners.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay profesionales.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.practitioners.map((practitioner) => (
            <li key={practitioner.id}>
              <Card>
                <CardContent>
                  <Link
                    to="/horarios/$practitionerId"
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
