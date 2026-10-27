import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { freeStartsByDay } from "#/lib/availability.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today } from "#/lib/schedules.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { getAvailabilityPractitioners, getFreeTimes } from "#/server/availability.functions.ts";

const defaultDuration = 30;

// What is being viewed lives in the URL, so a view can be reloaded and shared.
// A value that does not parse falls back to its default.
const searchSchema = z.object({
  profesional: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  vista: z.enum(["dia", "semana"]).optional().catch(undefined),
  duracion: z.int().min(5).max(720).optional().catch(undefined),
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
    const query = queryOf(deps, listed.practitioners);
    const window = windowOf(query);
    return {
      ok: true as const,
      practitioners: listed.practitioners,
      query,
      freeTimes: window ? await getFreeTimes({ data: window }) : null,
    };
  },
  component: Availability,
});

type Query = {
  practitionerId: string | undefined;
  firstDate: string;
  durationMinutes: number;
  week: boolean;
};

/** What the URL asks for, with its defaults: the only practitioner, today, a day, 30 minutes. */
function queryOf(search: z.infer<typeof searchSchema>, practitioners: { id: string }[]): Query {
  return {
    practitionerId: search.profesional ?? onlyId(practitioners),
    firstDate: search.fecha ?? today(defaultTimeZone),
    durationMinutes: search.duracion ?? defaultDuration,
    week: search.vista === "semana",
  };
}

function onlyId(practitioners: { id: string }[]): string | undefined {
  return practitioners.length === 1 ? practitioners[0]!.id : undefined;
}

/** The service's query, once a practitioner is chosen. */
function windowOf(query: Query) {
  const { practitionerId, firstDate, durationMinutes } = query;
  if (!practitionerId) {
    return null;
  }
  const lastDate = query.week ? shiftDate(firstDate, 6) : firstDate;
  return { practitionerId, firstDate, lastDate, durationMinutes };
}

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
        <QueryForm practitioners={result.practitioners} query={result.query} />
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

function QueryForm(props: { practitioners: { id: string; displayName: string }[]; query: Query }) {
  const navigate = useNavigate();
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
    void navigate({ to: "/disponibilidad", search });
  }

  return (
    <Card>
      <CardContent>
        <form
          // Remounting on a new query resets the fields to what is being viewed.
          key={JSON.stringify(query)}
          onSubmit={submit}
          className="grid gap-4 sm:grid-cols-2"
        >
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
              min={5}
              max={720}
              step={5}
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
