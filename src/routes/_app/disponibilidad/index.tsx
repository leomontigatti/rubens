import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  availabilityViewOf,
  durationMinutesSchema,
  freeStartsByDay,
  freeTimesQueryOf,
} from "#/lib/availability.ts";
import type { AvailabilityView } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { getAvailabilityPractitioners, getFreeTimes } from "#/server/availability.functions.ts";

// What is being viewed lives in the URL, so a view can be reloaded and shared.
// A value that does not parse falls back to its default.
const searchSchema = z.object({
  profesional: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  vista: z.enum(["dia", "semana"]).optional().catch(undefined),
  duracion: durationMinutesSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_app/disponibilidad/")({
  head: () => ({ meta: [{ title: "Disponibilidad · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const listed = await getAvailabilityPractitioners();
    if (!listed.ok) {
      return listed;
    }
    const query = availabilityViewOf(deps, listed.practitioners, today(defaultTimeZone));
    const window = freeTimesQueryOf(query);
    return {
      ok: true as const,
      practitioners: listed.practitioners,
      query,
      freeTimes: window ? await getFreeTimes({ data: window }) : null,
    };
  },
  component: Availability,
});

/** The copy for every refusal the availability server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden:
    "Solo recepción, un administrador o el propio profesional pueden ver su disponibilidad.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la fecha y la duración.",
  notFound: "No encontramos ese profesional.",
};

function Availability() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Disponibilidad</h1>
      {result.practitioners.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay profesionales.</p>
      ) : (
        <QueryForm
          // Remounting on a new query resets the fields and any error to what is being viewed.
          key={JSON.stringify(result.query)}
          practitioners={result.practitioners}
          query={result.query}
        />
      )}
      {result.freeTimes && <FreeTimesResult result={result.freeTimes} />}
    </div>
  );
}

function FreeTimesResult(props: {
  result:
    | { ok: true; freeStarts: AvailableStart[] }
    | { ok: false; reason: keyof typeof refusalMessages };
}) {
  if (!props.result.ok) {
    return <RefusalMessage message={refusalMessages[props.result.reason]} />;
  }
  return <FreeTimes starts={props.result.freeStarts} />;
}

/** What the query form is missing, `null` when it can be viewed. */
function queryProblem(search: z.output<typeof searchSchema>): string | null {
  if (!search.profesional) {
    return "Elegí un profesional.";
  }
  if (!search.fecha) {
    return "Ingresá la fecha.";
  }
  if (search.duracion === undefined) {
    return "Ingresá una duración de 1 a 720 minutos.";
  }
  return null;
}

function QueryForm(props: {
  practitioners: { id: string; displayName: string }[];
  query: AvailabilityView;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { query } = props;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = searchSchema.parse({
      profesional: form.get("practitionerId") || undefined,
      fecha: form.get("firstDate") || undefined,
      vista: form.get("view"),
      duracion: Number(form.get("durationMinutes")),
    });
    const problem = queryProblem(search);
    setError(problem);
    if (problem) {
      return;
    }
    void navigate({ to: "/disponibilidad", search });
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <ErrorAlert message={error} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="practitionerId">Profesional</Label>
            <NativeSelect
              id="practitionerId"
              name="practitionerId"
              defaultValue={query.practitionerId ?? ""}
              required
            >
              <NativeSelectOption value="" disabled>
                Elegí un profesional
              </NativeSelectOption>
              {props.practitioners.map((practitioner) => (
                <NativeSelectOption key={practitioner.id} value={practitioner.id}>
                  {practitioner.displayName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstDate">Fecha</Label>
            <Input
              id="firstDate"
              name="firstDate"
              type="date"
              defaultValue={query.firstDate}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="view">Ver</Label>
            <NativeSelect id="view" name="view" defaultValue={query.week ? "semana" : "dia"}>
              <NativeSelectOption value="dia">El día</NativeSelectOption>
              <NativeSelectOption value="semana">7 días desde la fecha</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="durationMinutes">Duración (minutos)</Label>
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={1}
              max={720}
              defaultValue={query.durationMinutes}
              required
            />
          </div>
          <div>
            <Button type="submit">Ver disponibilidad</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FreeTimes({ starts }: { starts: AvailableStart[] }) {
  if (starts.length === 0) {
    return <p className="text-muted-foreground">No hay horarios libres en esas fechas.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {freeStartsByDay(starts).map((day) => (
        <Card key={day.date}>
          <CardHeader>
            <CardTitle>{day.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {day.starts.map((free) => (
                <li key={+free.start} className="flex gap-3">
                  <span className="font-medium tabular-nums">{free.time}</span>
                  <span className="text-muted-foreground">
                    {free.officeName}, {free.roomName}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
